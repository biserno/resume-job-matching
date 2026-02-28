import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { JobDescription, MatchResult, Resume } from "@/app/generated/prisma";

type PythonMatchResponse = {
  results: Array<{
    jobId: number;
    score: number;
    overlapScore: number;
    semanticScore: number;
    missingSkills: string[];
    tips: string[];
  }>;
};

function normalizeScore(score: number) {
  // Accept either 0..1 or 0..100
  if (score <= 1) return score * 100;
  return score;
}

export async function GET() {
  const matches = await prisma.matchResult.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      resume: true,
      job: true,
    },
  });

  type MatchWithRelations = MatchResult & {
    resume: Resume;
    job: JobDescription;
  };

  const enriched = (matches as MatchWithRelations[]).map((m: MatchWithRelations) => ({
    ...m,
    missingSkillsParsed: (() => {
      try {
        return JSON.parse(m.missingSkills);
      } catch {
        return m.missingSkills;
      }
    })(),
  }));

  return NextResponse.json(enriched);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const resumeId = Number(body?.resumeId);

    const jobIds: number[] = Array.isArray(body?.jobIds)
      ? body.jobIds
          .map((x: unknown) => Number(x))
          .filter((n: number) => Number.isFinite(n))
      : body?.jobId != null
        ? [Number(body.jobId)]
        : [];

    if (!Number.isFinite(resumeId)) {
      return NextResponse.json({ error: "resumeId is required" }, { status: 400 });
    }
    if (jobIds.length === 0) {
      return NextResponse.json({ error: "jobIds (or jobId) is required" }, { status: 400 });
    }

    const resume = await prisma.resume.findUnique({ where: { id: resumeId } });
    if (!resume) {
      return NextResponse.json({ error: "Resume not found" }, { status: 404 });
    }

    const jobs = await prisma.jobDescription.findMany({
      where: { id: { in: jobIds } },
    });

    if (jobs.length === 0) {
      return NextResponse.json({ error: "No matching jobs found" }, { status: 404 });
    }

    const nlpUrl = process.env.NLP_SERVICE_URL;
    if (!nlpUrl) {
      return NextResponse.json(
        { error: "NLP_SERVICE_URL is not set. Add it to your environment." },
        { status: 500 }
      );
    }

    // Call Python FastAPI service
    const pyRes = await fetch(`${nlpUrl.replace(/\/$/, "")}/match`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        resume_text: resume.content,
        jobs: (jobs as JobDescription[]).map((j: JobDescription) => ({
          id: j.id,
          title: j.title,
          content: j.content,
        })),
      }),
    });

    if (!pyRes.ok) {
      const text = await pyRes.text().catch(() => "");
      return NextResponse.json(
        { error: "Python NLP service error", details: text || pyRes.statusText },
        { status: 502 }
      );
    }

    const pyJson = (await pyRes.json()) as PythonMatchResponse;

    if (!pyJson?.results?.length) {
      return NextResponse.json({ error: "Python returned no results" }, { status: 502 });
    }

    const data = pyJson.results.map((r) => ({
      resumeId,
      jobId: r.jobId,
      score: normalizeScore(r.score),
      missingSkills: JSON.stringify({
        missing: r.missingSkills ?? [],
        overlapScore: Math.round((r.overlapScore ?? 0) * 100),
        semanticScore: Math.round((r.semanticScore ?? 0) * 100),
        tips: r.tips ?? [],
      }),
    }));

    // Avoid duplicates by deleting existing results for same resume+jobs
    await prisma.matchResult.deleteMany({
      where: { resumeId, jobId: { in: data.map((d) => d.jobId) } },
    });

    await prisma.matchResult.createMany({ data });

    const saved = await prisma.matchResult.findMany({
      where: { resumeId, jobId: { in: data.map((d) => d.jobId) } },
      include: { resume: true, job: true },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(saved, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}