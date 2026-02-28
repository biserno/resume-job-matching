from __future__ import annotations

from fastapi import FastAPI, UploadFile, File, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Set
import re
import io
import os
import json
from pathlib import Path

import spacy
from spacy.matcher import PhraseMatcher
from rapidfuzz import fuzz
from pypdf import PdfReader
from docx import Document
# Suppress TF/Keras warnings before importing sentence_transformers
os.environ.setdefault("TRANSFORMERS_NO_TF", "1")
os.environ.setdefault("USE_TORCH", "1")
from sentence_transformers import SentenceTransformer, util as st_util


app = FastAPI(
    title="Resume Analyzer NLP Service",
    version="1.0.0",
)


# -------------------------
# Data models (API contract)
# -------------------------
class JobIn(BaseModel):
    id: int
    title: str
    content: str


class MatchRequest(BaseModel):
    resume_text: str = Field(..., min_length=1)
    jobs: List[JobIn] = Field(..., min_length=1)


class MatchResultOut(BaseModel):
    jobId: int
    score: float
    overlapScore: float
    semanticScore: float
    missingSkills: List[str]
    tips: List[str]


class MatchResponse(BaseModel):
    results: List[MatchResultOut]


class ExtractSkillsRequest(BaseModel):
    text: str = Field(..., min_length=1)


class ExtractSkillsResponse(BaseModel):
    skills: List[str]
    skillsPretty: List[str]
    count: int


# -------------------------
# Load skills from skills.json
# -------------------------
SKILLS_PATH = Path(__file__).with_name("skills.json")
if not SKILLS_PATH.exists():
    raise RuntimeError(
        f"skills.json not found at {SKILLS_PATH}. Create nlp_service/skills.json."
    )

with SKILLS_PATH.open("r", encoding="utf-8") as f:
    SKILLS: Dict[str, List[str]] = json.load(f)

# Build a reverse lookup: alias (lowered) -> skill_id for fuzzy matching
ALIAS_TO_SKILL: Dict[str, str] = {}
for skill_id, aliases in SKILLS.items():
    for alias in aliases:
        ALIAS_TO_SKILL[alias.lower()] = skill_id

# All known aliases for fuzzy matching (only aliases with 4+ chars to avoid short-word noise)
ALL_ALIASES: List[str] = [a for a in ALIAS_TO_SKILL.keys() if len(a) >= 4]

# Short aliases that are too ambiguous as standalone words and should only match
# when they appear in a skills section or as exact comma-separated items
AMBIGUOUS_SHORT_ALIASES = {"py", "js", "ts", "ml", "dl", "rl", "tf", "cv2", "sas", "r", "go", "vue", "css", "html", "sql", "php", "git", "aws", "gcp", "jwt", "etl", "cdn", "crm", "erp", "iot", "nlp", "seo", "sem", "dbt", "vba"}

# Skill category weights: technical skills weigh more than soft skills in scoring
SKILL_CATEGORY_WEIGHTS: Dict[str, float] = {}

# Technical / hard skills get higher weight
HARD_SKILL_IDS = {
    "python", "java", "javascript", "typescript", "c", "c_plus_plus", "c_sharp",
    "go", "rust", "ruby", "php", "swift", "kotlin", "scala", "r_lang", "matlab",
    "sql", "nosql", "mongodb", "redis", "cassandra", "elasticsearch", "dynamodb",
    "html", "css", "react", "nextjs", "vue", "angular", "svelte", "nodejs",
    "express", "fastapi", "django", "flask", "spring", "rails", "laravel",
    "aspnet", "dotnet", "docker", "kubernetes", "terraform", "aws", "azure", "gcp",
    "ci_cd", "git", "linux", "pandas", "numpy", "scikit_learn", "tensorflow",
    "pytorch", "keras", "machine_learning", "deep_learning", "nlp",
    "computer_vision", "data_science", "data_engineering", "statistics",
    "apache_spark", "hadoop", "kafka", "airflow", "snowflake", "databricks",
    "excel", "power_bi", "tableau", "graphql", "rest_apis", "microservices",
    "etl", "data_warehouse", "blockchain", "cybersecurity",
    "finance", "valuation", "dcf", "lbo", "wacc", "risk_management",
    "portfolio_management", "fixed_income", "derivatives", "options",
    "black_scholes", "monte_carlo", "trading", "bloomberg",
}

for sid in SKILLS:
    if sid in HARD_SKILL_IDS:
        SKILL_CATEGORY_WEIGHTS[sid] = 1.5
    else:
        SKILL_CATEGORY_WEIGHTS[sid] = 1.0


# -------------------------
# Regex skills (symbol-heavy / common patterns that PhraseMatcher can't handle)
# -------------------------
REGEX_SKILLS: Dict[str, re.Pattern] = {
    "c_plus_plus": re.compile(r"\bc\+\+\b", re.IGNORECASE),
    "c_sharp": re.compile(r"\bc#\b", re.IGNORECASE),
    "dotnet": re.compile(r"\b\.net\b|\bdotnet\b", re.IGNORECASE),
    "aspnet": re.compile(r"\basp\.net\b", re.IGNORECASE),
    "aws": re.compile(r"\baws\b|amazon\s+web\s+services", re.IGNORECASE),
    "gcp": re.compile(r"\bgcp\b|google\s+cloud", re.IGNORECASE),
    "s_and_p_500": re.compile(r"\bs&p\s*500\b", re.IGNORECASE),
    "ci_cd": re.compile(r"\bci\s*/\s*cd\b|\bci/cd\b", re.IGNORECASE),
    "ui_ux": re.compile(r"\bui\s*/\s*ux\b|\bui/ux\b|\bux/ui\b", re.IGNORECASE),
    "ab_testing": re.compile(r"\ba/b\s+testing\b", re.IGNORECASE),
    "oauth": re.compile(r"\boauth\s*2?\.?0?\b", re.IGNORECASE),
    "nodejs": re.compile(r"\bnode\.js\b", re.IGNORECASE),
    "nextjs": re.compile(r"\bnext\.js\b", re.IGNORECASE),
    "vue": re.compile(r"\bvue\.js\b", re.IGNORECASE),
    "express": re.compile(r"\bexpress\.js\b", re.IGNORECASE),
    "react": re.compile(r"\breact\.js\b", re.IGNORECASE),
    "angular": re.compile(r"\bangular\.js\b|\bangularjs\b", re.IGNORECASE),
    "nestjs": re.compile(r"\bnest\.js\b", re.IGNORECASE),
    "nuxt": re.compile(r"\bnuxt\.js\b", re.IGNORECASE),
    "r_lang": re.compile(r"(?<![a-zA-Z])\bR\b(?=\s+(programming|language|studio|statistical))", re.IGNORECASE),
    "kyc_aml": re.compile(r"\bkyc\b|\baml\b", re.IGNORECASE),
    "soc2": re.compile(r"\bsoc\s*2\b|\bsoc\s*ii\b", re.IGNORECASE),
    "six_sigma": re.compile(r"\b6\s*sigma\b|\bsix\s+sigma\b", re.IGNORECASE),
    "ar_vr": re.compile(r"\bar\s*/\s*vr\b|\bar/vr\b", re.IGNORECASE),
    "investment_banking": re.compile(r"\bm&a\b|\bmergers?\s+and\s+acquisitions?\b", re.IGNORECASE),
    "networking": re.compile(r"\btcp\s*/\s*ip\b|\btcp/ip\b", re.IGNORECASE),
    "pl_sql": re.compile(r"\bpl\s*/\s*sql\b|\bpl/sql\b", re.IGNORECASE),
}


# -------------------------
# Section extraction (improved heuristics)
# -------------------------
SECTION_HEADER_RE = re.compile(
    r"^\s*"
    r"(skills|technical\s+skills|core\s+skills|key\s+skills|"
    r"tools|technologies|tech\s+stack|languages|"
    r"programming\s+languages|software|competencies|"
    r"technical\s+competencies|areas\s+of\s+expertise|"
    r"proficiencies|qualifications|technical\s+proficiencies|"
    r"tools\s+&\s+technologies|tools\s+and\s+technologies|"
    r"skills\s+&\s+tools|skills\s+and\s+tools|"
    r"technical\s+expertise|relevant\s+skills)"
    r"\s*:?\s*$",
    re.IGNORECASE,
)

GENERIC_HEADER_RE = re.compile(
    r"^\s*"
    r"(education|experience|work\s+experience|professional\s+experience|"
    r"projects|personal\s+projects|summary|professional\s+summary|"
    r"objective|certifications|certificates|activities|"
    r"awards|honors|publications|references|interests|"
    r"hobbies|volunteer|extracurricular|achievements|"
    r"employment\s+history|work\s+history|career\s+history)"
    r"\s*:?\s*$",
    re.IGNORECASE,
)


def extract_skills_section(text: str) -> str:
    """
    Heuristic: find a 'Skills' header, then return the text until the next header.
    """
    lines = (text or "").splitlines()
    start = None

    for i, line in enumerate(lines):
        stripped = line.strip()
        if SECTION_HEADER_RE.match(stripped):
            start = i + 1
            break

    if start is None:
        return ""

    collected: List[str] = []
    for line in lines[start:]:
        s = line.strip()
        if not s:
            collected.append("")
            continue
        if GENERIC_HEADER_RE.match(s) or SECTION_HEADER_RE.match(s):
            break
        if len(s) <= 30 and s.isupper() and not any(c.isdigit() for c in s):
            break
        collected.append(s)

    return "\n".join(collected).strip()


def extract_experience_section(text: str) -> str:
    """
    Extract the experience/work section for context-aware skill extraction.
    """
    lines = (text or "").splitlines()
    exp_re = re.compile(
        r"^\s*(experience|work\s+experience|professional\s+experience|"
        r"employment\s+history|work\s+history|career\s+history)\s*:?\s*$",
        re.IGNORECASE,
    )
    start = None
    for i, line in enumerate(lines):
        if exp_re.match(line.strip()):
            start = i + 1
            break

    if start is None:
        return ""

    collected: List[str] = []
    for line in lines[start:]:
        s = line.strip()
        if not s:
            collected.append("")
            continue
        if GENERIC_HEADER_RE.match(s) or SECTION_HEADER_RE.match(s):
            break
        if len(s) <= 30 and s.isupper() and not any(c.isdigit() for c in s):
            break
        collected.append(s)

    return "\n".join(collected).strip()


# -------------------------
# Sentence-Transformers setup (for semantic similarity scoring)
# -------------------------
_EMBED_MODEL_NAME = "all-MiniLM-L6-v2"
embed_model = SentenceTransformer(_EMBED_MODEL_NAME)


def embedding_similarity(text_a: str, text_b: str) -> float:
    """
    Compute cosine similarity between two texts using SentenceTransformers.
    Returns a float in [0, 1].
    """
    if not text_a or not text_b:
        return 0.0
    # Truncate very long texts to first ~1500 words to keep encoding fast
    max_words = 1500
    a_trunc = " ".join(text_a.split()[:max_words])
    b_trunc = " ".join(text_b.split()[:max_words])
    embs = embed_model.encode([a_trunc, b_trunc], convert_to_tensor=True)
    cos_sim = st_util.cos_sim(embs[0], embs[1]).item()
    return max(0.0, min(1.0, cos_sim))


# -------------------------
# spaCy setup
# -------------------------
nlp = spacy.load("en_core_web_sm", disable=["ner", "parser"])
nlp.max_length = 2_000_000

matcher = PhraseMatcher(nlp.vocab, attr="LOWER")

for skill_id, aliases in SKILLS.items():
    patterns = [nlp.make_doc(a) for a in aliases]
    matcher.add(f"SKILL::{skill_id}", patterns)


# -------------------------
# Text preprocessing
# -------------------------
def preprocess_text(text: str) -> str:
    """Clean and normalize text for better matching."""
    if not text:
        return ""
    # Normalize unicode
    text = text.replace("\u2019", "'").replace("\u2018", "'")
    text = text.replace("\u201c", '"').replace("\u201d", '"')
    text = text.replace("\u2013", "-").replace("\u2014", "-")
    text = text.replace("\u2022", " ").replace("\u25cf", " ")  # bullet points
    # Normalize whitespace but preserve newlines for section detection
    text = re.sub(r"[ \t]+", " ", text)
    # Remove extra blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def flatten_text(text: str) -> str:
    """Flatten text to single line for matching."""
    return re.sub(r"\s+", " ", text).strip()


# -------------------------
# Skill extraction (multi-strategy)
# -------------------------
def extract_skills_phrase_matcher(text: str) -> Set[str]:
    """Extract skills using spaCy PhraseMatcher."""
    if not text:
        return set()

    found: Set[str] = set()
    doc = nlp(text)
    matches = matcher(doc)
    for match_id, _start, _end in matches:
        label = nlp.vocab.strings[match_id]
        if label.startswith("SKILL::"):
            found.add(label.split("SKILL::", 1)[1])
    return found


def extract_skills_regex(text: str) -> Set[str]:
    """Extract skills using regex patterns for symbol-heavy terms."""
    if not text:
        return set()

    found: Set[str] = set()
    for skill_id, pattern in REGEX_SKILLS.items():
        if pattern.search(text):
            found.add(skill_id)
    return found


def extract_skills_lemma(text: str) -> Set[str]:
    """
    Extract skills by lemmatizing the text and re-running PhraseMatcher.
    Catches morphological variants (e.g., 'managed' -> 'manage').
    """
    if not text:
        return set()

    doc = nlp(text)
    lemmatized = " ".join(token.lemma_ for token in doc)

    found: Set[str] = set()
    lemma_doc = nlp(lemmatized)
    matches = matcher(lemma_doc)
    for match_id, _start, _end in matches:
        label = nlp.vocab.strings[match_id]
        if label.startswith("SKILL::"):
            found.add(label.split("SKILL::", 1)[1])
    return found


def extract_skills_comma_split(text: str) -> Set[str]:
    """
    Many resumes list skills as comma/pipe/semicolon separated values.
    Split on those delimiters and try to match each chunk.
    """
    if not text:
        return set()

    found: Set[str] = set()
    chunks = re.split(r"[,;|•·▪►●\n]", text)

    for chunk in chunks:
        chunk = chunk.strip().lower()
        if not chunk or len(chunk) > 60:
            continue
        # Skip very short chunks that are likely noise
        if len(chunk) < 2:
            continue

        # Direct alias match
        if chunk in ALIAS_TO_SKILL:
            found.add(ALIAS_TO_SKILL[chunk])
            continue

        # Fuzzy match only for chunks with 4+ chars to avoid noise
        if len(chunk) < 4:
            continue

        best_score = 0
        best_skill = None
        for alias in ALL_ALIASES:
            if abs(len(alias) - len(chunk)) > 3:
                continue
            score = fuzz.ratio(chunk, alias)
            if score > best_score:
                best_score = score
                best_skill = ALIAS_TO_SKILL[alias]

        if best_score >= 90 and best_skill:
            found.add(best_skill)

    return found


def extract_skills_ngram(text: str, allow_short: bool = False) -> Set[str]:
    """
    Generate n-grams (1 to 4 words) from text and match against known aliases.
    This catches skills that PhraseMatcher might miss due to tokenization.
    When allow_short=False, skip single-word aliases shorter than 4 chars
    to avoid false positives from common short words.
    """
    if not text:
        return set()

    found: Set[str] = set()
    words = flatten_text(text).lower().split()

    for n in range(1, 5):
        for i in range(len(words) - n + 1):
            ngram = " ".join(words[i:i + n])
            if ngram in ALIAS_TO_SKILL:
                # Skip very short single-word aliases unless in skills section
                if not allow_short and n == 1 and len(ngram) < 4:
                    continue
                found.add(ALIAS_TO_SKILL[ngram])

    return found


def extract_all_skills(text: str) -> Set[str]:
    """
    Run all extraction strategies and combine results.
    """
    if not text:
        return set()

    preprocessed = preprocess_text(text)
    flat = flatten_text(preprocessed)

    found: Set[str] = set()

    # Strategy 1: PhraseMatcher on full text
    found |= extract_skills_phrase_matcher(flat)

    # Strategy 2: Regex for symbol-heavy skills
    found |= extract_skills_regex(preprocessed)

    # Strategy 3: Lemmatized text matching
    found |= extract_skills_lemma(flat)

    # Strategy 4: N-gram matching (strict: no short aliases)
    found |= extract_skills_ngram(flat, allow_short=False)

    # Strategy 5: Skills section - comma/delimiter split + fuzzy
    # In skills sections, we allow short aliases since they're explicitly listed
    skills_section = extract_skills_section(preprocessed)
    if skills_section:
        found |= extract_skills_phrase_matcher(flatten_text(skills_section))
        found |= extract_skills_regex(skills_section)
        found |= extract_skills_comma_split(skills_section)
        found |= extract_skills_ngram(flatten_text(skills_section), allow_short=True)

    # Strategy 6: Experience section (strict: no short aliases)
    exp_section = extract_experience_section(preprocessed)
    if exp_section:
        found |= extract_skills_phrase_matcher(flatten_text(exp_section))
        found |= extract_skills_regex(exp_section)
        found |= extract_skills_ngram(flatten_text(exp_section), allow_short=False)

    return found


# -------------------------
# Pretty printing
# -------------------------
PRETTY_NAMES: Dict[str, str] = {
    "c_plus_plus": "C++",
    "c_sharp": "C#",
    "dotnet": ".NET",
    "aspnet": "ASP.NET",
    "nodejs": "Node.js",
    "nextjs": "Next.js",
    "vue": "Vue.js",
    "nuxt": "Nuxt.js",
    "nestjs": "NestJS",
    "react": "React",
    "angular": "Angular",
    "svelte": "Svelte",
    "express": "Express.js",
    "fastapi": "FastAPI",
    "graphql": "GraphQL",
    "rest_apis": "REST APIs",
    "ci_cd": "CI/CD",
    "ui_ux": "UI/UX",
    "ab_testing": "A/B Testing",
    "r_lang": "R",
    "sql": "SQL",
    "nosql": "NoSQL",
    "mongodb": "MongoDB",
    "dynamodb": "DynamoDB",
    "neo4j": "Neo4j",
    "aws": "AWS",
    "gcp": "GCP",
    "azure": "Azure",
    "docker": "Docker",
    "kubernetes": "Kubernetes",
    "terraform": "Terraform",
    "html": "HTML",
    "css": "CSS",
    "sass": "Sass/SCSS",
    "tailwindcss": "Tailwind CSS",
    "redux": "Redux",
    "webpack": "Webpack",
    "vite": "Vite",
    "jwt": "JWT",
    "oauth": "OAuth",
    "grpc": "gRPC",
    "websockets": "WebSockets",
    "github_actions": "GitHub Actions",
    "gitlab_ci": "GitLab CI",
    "circleci": "CircleCI",
    "scikit_learn": "scikit-learn",
    "tensorflow": "TensorFlow",
    "pytorch": "PyTorch",
    "xgboost": "XGBoost",
    "lightgbm": "LightGBM",
    "catboost": "CatBoost",
    "huggingface": "Hugging Face",
    "opencv": "OpenCV",
    "nlp": "NLP",
    "rag": "RAG",
    "langchain": "LangChain",
    "generative_ai": "Generative AI",
    "machine_learning": "Machine Learning",
    "deep_learning": "Deep Learning",
    "computer_vision": "Computer Vision",
    "reinforcement_learning": "Reinforcement Learning",
    "data_science": "Data Science",
    "data_analysis": "Data Analysis",
    "data_engineering": "Data Engineering",
    "data_visualization": "Data Visualization",
    "apache_spark": "Apache Spark",
    "hadoop": "Hadoop",
    "kafka": "Kafka",
    "airflow": "Airflow",
    "dbt": "dbt",
    "bigquery": "BigQuery",
    "redshift": "Redshift",
    "data_warehouse": "Data Warehouse",
    "data_lake": "Data Lake",
    "power_bi": "Power BI",
    "google_analytics": "Google Analytics",
    "etl": "ETL",
    "vba": "VBA",
    "sas": "SAS",
    "spss": "SPSS",
    "dcf": "DCF",
    "lbo": "LBO",
    "wacc": "WACC",
    "var": "VaR",
    "black_scholes": "Black-Scholes",
    "monte_carlo": "Monte Carlo",
    "s_and_p_500": "S&P 500",
    "kyc_aml": "KYC/AML",
    "cfa": "CFA",
    "frm": "FRM",
    "pmp": "PMP",
    "soc2": "SOC 2",
    "gdpr": "GDPR",
    "erp": "ERP",
    "crm": "CRM",
    "cdn": "CDN",
    "iot": "IoT",
    "ar_vr": "AR/VR",
    "six_sigma": "Six Sigma",
    "web3": "Web3",
    "react_native": "React Native",
    "ios_development": "iOS Development",
    "android_development": "Android Development",
    "shell_scripting": "Shell Scripting",
    "objective_c": "Objective-C",
    "pl_sql": "PL/SQL",
    "e2e_testing": "E2E Testing",
    "unit_testing": "Unit Testing",
    "integration_testing": "Integration Testing",
}


def pretty_skill(skill_id: str) -> str:
    if skill_id in PRETTY_NAMES:
        return PRETTY_NAMES[skill_id]
    return skill_id.replace("_", " ").title()


# -------------------------
# Scoring
# -------------------------
OVERLAP_WEIGHT = 0.6
EMBEDDING_WEIGHT = 0.4


def weighted_overlap_score(resume_skills: Set[str], job_skills: Set[str]) -> float:
    """
    Score in [0, 1] using weighted overlap.
    Hard/technical skills weigh more than soft skills.
    """
    if not job_skills:
        return 0.0

    def w(s: str) -> float:
        return SKILL_CATEGORY_WEIGHTS.get(s, 1.0)

    denom = sum(w(s) for s in job_skills)
    if denom <= 0:
        return 0.0

    matched = resume_skills.intersection(job_skills)
    num = sum(w(s) for s in matched)

    raw = num / denom

    # Apply a slight curve: reward having most skills, penalize large gaps
    curved = raw ** 0.85

    return max(0.0, min(1.0, curved))


def combined_score(resume_text: str, job_text: str, resume_skills: Set[str], job_skills: Set[str],) -> float:
    """
    Final score = 0.6 * skills_overlap + 0.4 * embedding_similarity
    """
    overlap = weighted_overlap_score(resume_skills, job_skills)
    semantic = embedding_similarity(resume_text, job_text)
    final = OVERLAP_WEIGHT * overlap + EMBEDDING_WEIGHT * semantic
    return max(0.0, min(1.0, final))


# -------------------------
# Routes
# -------------------------
@app.get("/health")
def health():
    return {"ok": True}


@app.post("/extract_skills", response_model=ExtractSkillsResponse)
def extract_skills_endpoint(req: ExtractSkillsRequest):
    skills = extract_all_skills(req.text)
    skills_sorted = sorted(skills)
    return ExtractSkillsResponse(
        skills=skills_sorted,
        skillsPretty=[pretty_skill(s) for s in skills_sorted],
        count=len(skills_sorted),
    )


@app.post("/parse")
async def parse(file: UploadFile = File(...)):
    """
    Accepts: .pdf, .docx, .txt
    Returns: { fileName, text }
    """
    filename = file.filename or "upload"
    ext = os.path.splitext(filename.lower())[1]

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")

    try:
        if ext == ".pdf":
            reader = PdfReader(io.BytesIO(data))
            parts = []
            for page in reader.pages:
                parts.append(page.extract_text() or "")
            text = "\n".join(parts).strip()

        elif ext == ".docx":
            doc = Document(io.BytesIO(data))
            text = "\n".join(p.text for p in doc.paragraphs).strip()

        elif ext == ".txt":
            text = data.decode("utf-8", errors="ignore").strip()

        else:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file type. Use PDF, DOCX, or TXT.",
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {e}")

    if not text:
        raise HTTPException(
            status_code=400, detail="Could not extract any text from file"
        )

    return {"fileName": filename, "text": text}


def generate_tips(overlap: float, semantic: float, missing: List[str], resume_skills: Set[str], job_skills: Set[str],) -> List[str]:
    """Generate actionable tips to help the user improve their score."""
    tips: List[str] = []

    matched_count = len(resume_skills & job_skills)
    total_job = len(job_skills)

    # Skills overlap tips
    if len(missing) > 0:
        if len(missing) <= 3:
            tips.append(
                f"Add these {len(missing)} missing skill(s) to your resume: {', '.join(missing[:3])}."
            )
        else:
            tips.append(
                f"You're missing {len(missing)} skills. Prioritize adding: {', '.join(missing[:3])}."
            )

    if overlap >= 0.9:
        tips.append("Great skill coverage! Your skills match almost all job requirements.")
    elif overlap >= 0.6:
        tips.append(
            f"You match {matched_count}/{total_job} required skills ({overlap:.0%}). "
            "Adding the missing ones could significantly boost your score."
        )
    elif overlap > 0:
        tips.append(
            f"Only {matched_count}/{total_job} skills match. "
            "Consider gaining experience in the missing areas or highlighting relevant projects."
        )
    else:
        tips.append("No skill overlap detected. This role may require a different skill set.")

    # Semantic similarity tips
    if semantic < 0.4:
        tips.append(
            "Your resume language doesn't closely match this job description. "
            "Try mirroring key phrases and terminology from the job posting."
        )
    elif semantic < 0.6:
        tips.append(
            "Moderate language match. Use more keywords and phrases from the job description "
            "in your experience descriptions and summary."
        )
    elif semantic < 0.75:
        tips.append(
            "Good language alignment. Fine-tune by incorporating specific terms "
            "the employer uses (e.g., their tech stack names, methodologies)."
        )
    else:
        tips.append("Excellent language alignment with the job description.")

    # General resume tips based on score components
    if overlap > 0.7 and semantic < 0.5:
        tips.append(
            "You have the right skills but your resume wording differs from the job. "
            "Tailor your descriptions to echo the job posting's language."
        )
    elif semantic > 0.7 and overlap < 0.5:
        tips.append(
            "Your resume reads well for this role but lacks key technical skills. "
            "Consider upskilling or highlighting transferable experience."
        )

    return tips


@app.post("/match", response_model=MatchResponse)
def match(req: MatchRequest):
    resume_skills = extract_all_skills(req.resume_text)

    results: List[MatchResultOut] = []
    for job in req.jobs:
        job_text = f"{job.title}\n{job.content}"
        job_skills = extract_all_skills(job_text)

        overlap = weighted_overlap_score(resume_skills, job_skills)
        semantic = embedding_similarity(req.resume_text, job_text)
        score = OVERLAP_WEIGHT * overlap + EMBEDDING_WEIGHT * semantic
        score = max(0.0, min(1.0, score))

        missing = sorted(job_skills - resume_skills)
        missing_pretty = [pretty_skill(s) for s in missing]

        tips = generate_tips(overlap, semantic, missing_pretty, resume_skills, job_skills)

        results.append(
            MatchResultOut(
                jobId=job.id,
                score=score,
                overlapScore=overlap,
                semanticScore=semantic,
                missingSkills=missing_pretty,
                tips=tips,
            )
        )

    results.sort(key=lambda r: r.score, reverse=True)
    return MatchResponse(results=results)
