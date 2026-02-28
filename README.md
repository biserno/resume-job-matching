# Resume-Job Matcher with AI-Powered Scoring

An intelligent resume-job matching system that uses NLP techniques to analyze resumes against job descriptions, providing detailed scoring breakdowns and actionable improvement tips.

## Features

### Core Functionality
- **Resume Management**: Upload PDF/DOCX files or paste text directly
- **Job Description Management**: Store and manage multiple job descriptions
- **AI-Powered Matching**: Sophisticated scoring combining skills overlap and semantic similarity
- **Skill Extraction**: Automatic extraction of 270+ technical and soft skills
- **Actionable Insights**: Detailed tips on how to improve match scores

### Scoring System
The system uses a hybrid scoring approach:
- **60% Skills Overlap**: Weighted matching of technical and soft skills
- **40% Semantic Similarity**: Language and context alignment using sentence transformers

## Installation

### Prerequisites
- Node.js 18+ and npm
- Python 3.8+
- Git

### Setup Instructions

1. **Clone the repository**
```bash
git clone https://gitlab.mff.cuni.cz/teaching/nprg045/kopecky/asadli_shahin_2026.git
cd asadli_shahin_2026
```

2. **Install Node.js dependencies**
```bash
npm install
```

3. **Set up the database**
```bash
npx prisma generate
npx prisma migrate deploy
```

4. **Install Python dependencies**
```bash
cd nlp_service
pip install -r requirements.txt
python -m spacy download en_core_web_sm
cd ..
```

5. **Configure environment variables**
Create a `.env` file in the root directory:
```env
DATABASE_URL="file:./dev.db"
NLP_SERVICE_URL="http://localhost:8000"
```

6. **Start the services**

In terminal 1 - Start the NLP service:
```bash
cd nlp_service
uvicorn main:app --reload --port 8000
```

In terminal 2 - Start the Next.js app:
```bash
npm run dev
```

The application will be available at `http://localhost:3000`

## Usage Guide

### 1. Adding Resumes
Navigate to the **Resumes** page:
- Upload PDF/DOCX files using the file picker
- Or paste resume text directly
- The system automatically extracts and displays detected skills

### 2. Adding Job Descriptions
Navigate to the **Jobs** page:
- Enter job title and description
- Skills are automatically extracted and shown as tags
- Edit existing jobs by clicking the Edit button

### 3. Running Matches
Navigate to the **Matches** page:
- Select a resume from the dropdown
- Choose one or more jobs to match against
- Click "Run Match" to generate results

### 4. Understanding Results
Each match result shows:
- **Overall Score**: Combined score (0-100%)
- **Score Breakdown**:
  - Skills Match: How well your skills align with requirements
  - Language Fit: Semantic similarity of your resume to the job
- **Missing Skills**: Skills mentioned in the job but not in your resume
- **Improvement Tips**: Actionable advice to increase your score

## NLP Features

### Skill Extraction Strategies
1. **PhraseMatcher**: Exact and fuzzy matching of skill phrases
2. **Regex Patterns**: Symbol-heavy terms (C++, C#, .NET)
3. **Lemmatization**: Catches morphological variants
4. **N-gram Analysis**: Multi-word skill detection
5. **Section-Aware**: Enhanced extraction from Skills/Experience sections
6. **Fuzzy Matching**: Handles typos and variations (90% threshold)

### Skills Database
- 270+ skill categories covering:
  - Programming languages
  - Frameworks and libraries
  - Databases and tools
  - Cloud platforms
  - Soft skills
  - Domain expertise (finance, data science, etc.)

### Scoring Algorithm
```python
final_score = 0.6 * skills_overlap + 0.4 * semantic_similarity
```

- **Skills Overlap**: Weighted Jaccard similarity with technical skills weighted 1.5x
- **Semantic Similarity**: Cosine similarity of sentence embeddings

## Known Issues

- First model load for embeddings takes ~30 seconds
- Large PDF files may take longer to process
- Skills in tables/images are not extracted