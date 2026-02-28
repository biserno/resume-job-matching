"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { PageHeader } from "@/components/PageHeader";
import { Tag } from "@/components/Tag";
import { EmptyState } from "@/components/EmptyState";

type ResumeRow = {
  id: number;
  fileName: string;
  content: string;
  createdAt: string;
};

type JobRow = {
  id: number;
  title: string;
  content: string;
  createdAt: string;
};

type MatchApiRow = {
  id: number;
  resumeId: number;
  jobId: number;
  score: number;
  missingSkills: string;
  createdAt: string;
  resume?: ResumeRow;
  job?: JobRow;
  missingSkillsParsed?: unknown;
};

type ParsedBreakdown = {
  missing: string[];
  overlapScore: number;
  semanticScore: number;
  tips: string[];
};

function parseBreakdown(raw: unknown): ParsedBreakdown {
  // New format: { missing, overlapScore, semanticScore, tips }
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    return {
      missing: Array.isArray(obj.missing)
        ? (obj.missing as string[]).filter((v) => typeof v === "string")
        : [],
      overlapScore: typeof obj.overlapScore === "number" ? obj.overlapScore : -1,
      semanticScore: typeof obj.semanticScore === "number" ? obj.semanticScore : -1,
      tips: Array.isArray(obj.tips)
        ? (obj.tips as string[]).filter((v) => typeof v === "string")
        : [],
    };
  }
  // Legacy format: just an array of strings
  if (Array.isArray(raw)) {
    return {
      missing: raw.filter((v) => typeof v === "string") as string[],
      overlapScore: -1,
      semanticScore: -1,
      tips: [],
    };
  }
  return { missing: [], overlapScore: -1, semanticScore: -1, tips: [] };
}

function scoreLabel(score: number) {
  const s = Math.round(score);
  if (s >= 85) return { label: "Strong", cls: "bg-green-50 border-green-200 text-green-800" };
  if (s >= 70) return { label: "Good", cls: "bg-blue-50 border-blue-200 text-blue-800" };
  if (s >= 55) return { label: "OK", cls: "bg-yellow-50 border-yellow-200 text-yellow-800" };
  return { label: "Weak", cls: "bg-red-50 border-red-200 text-red-800" };
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const color =
    value >= 75
      ? "bg-green-500"
      : value >= 50
        ? "bg-blue-500"
        : value >= 30
          ? "bg-yellow-500"
          : "bg-red-400";
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-xs text-neutral-600 shrink-0">{label}</div>
      <div className="flex-1 h-2.5 rounded-full bg-neutral-200 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${Math.max(2, value)}%` }}
        />
      </div>
      <div className="w-10 text-right text-xs font-medium text-neutral-700">{value}%</div>
    </div>
  );
}

export default function MatchesPage() {
  const [resumes, setResumes] = useState<ResumeRow[]>([]);
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [results, setResults] = useState<MatchApiRow[]>([]);

  const [selectedResumeId, setSelectedResumeId] = useState<number | null>(null);
  const [selectedJobIds, setSelectedJobIds] = useState<number[]>([]);

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [rRes, jRes, mRes] = await Promise.all([
        fetch("/api/resumes", { cache: "no-store" }),
        fetch("/api/jobs", { cache: "no-store" }),
        fetch("/api/match", { cache: "no-store" }),
      ]);

      if (!rRes.ok) throw new Error(await rRes.text());
      if (!jRes.ok) throw new Error(await jRes.text());
      if (!mRes.ok) throw new Error(await mRes.text());

      const rData = (await rRes.json()) as ResumeRow[];
      const jData = (await jRes.json()) as JobRow[];
      const mData = (await mRes.json()) as MatchApiRow[];

      setResumes(rData);
      setJobs(jData);
      setResults(mData);

      if (selectedResumeId == null && rData.length > 0) setSelectedResumeId(rData[0].id);
      if (selectedJobIds.length === 0 && jData.length > 0) setSelectedJobIds(jData.map((x) => x.id));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedResume = useMemo(
    () => resumes.find((r) => r.id === selectedResumeId) ?? null,
    [resumes, selectedResumeId]
  );

  const filteredResults = useMemo(() => {
    if (!selectedResumeId) return results;
    return results.filter((m) => m.resumeId === selectedResumeId);
  }, [results, selectedResumeId]);

  const canRun = useMemo(() => {
    return !!selectedResumeId && selectedJobIds.length > 0 && !running;
  }, [selectedResumeId, selectedJobIds.length, running]);

  function toggleJob(id: number) {
    setSelectedJobIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function runMatch() {
    if (!canRun || selectedResumeId == null) return;
    setRunning(true);
    setError(null);

    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resumeId: selectedResumeId,
          jobIds: selectedJobIds,
        }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Match failed");
      }

      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? "Match failed");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div>
      <PageHeader title="Matches" />

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Controls */}
        <Card>
          <h2 className="text-sm font-semibold">Select resume</h2>

          {loading ? (
            <div className="mt-3 text-sm text-neutral-600">Loading…</div>
          ) : resumes.length === 0 ? (
            <div className="mt-3 text-sm text-neutral-600">
              No resumes yet. Add one on the Resumes page.
            </div>
          ) : (
            <select
              className="mt-3 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm"
              value={selectedResumeId ?? ""}
              onChange={(e) => setSelectedResumeId(Number(e.target.value))}
            >
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.fileName}
                </option>
              ))}
            </select>
          )}

          {selectedResume ? (
            <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700">
              <div className="font-medium">Preview</div>
              <div className="mt-1 line-clamp-4 whitespace-pre-wrap">
                {selectedResume.content.slice(0, 300)}
                {selectedResume.content.length > 300 ? "…" : ""}
              </div>
            </div>
          ) : null}

          <h2 className="mt-6 text-sm font-semibold">Select jobs</h2>

          {loading ? (
            <div className="mt-3 text-sm text-neutral-600">Loading…</div>
          ) : jobs.length === 0 ? (
            <div className="mt-3 text-sm text-neutral-600">No jobs yet. Add one on the Jobs page.</div>
          ) : (
            <div className="mt-3 space-y-2">
              {jobs.map((j) => (
                <label
                  key={j.id}
                  className="flex items-start gap-2 rounded-xl border border-neutral-200 bg-white p-3 text-sm"
                >
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedJobIds.includes(j.id)}
                    onChange={() => toggleJob(j.id)}
                  />
                  <span className="leading-snug">
                    <span className="font-medium">{j.title}</span>
                  </span>
                </label>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => void runMatch()}
            disabled={!canRun}
            className="mt-5 w-full rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? "Running match…" : "Run Match"}
          </button>
        </Card>

        {/* Results */}
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
            <Card>
              <div className="text-sm text-neutral-600">Loading…</div>
            </Card>
          ) : resumes.length === 0 || jobs.length === 0 ? (
            <EmptyState
              title="Add resumes and jobs first"
              description="You need at least one resume and one job description before matching."
            />
          ) : filteredResults.length === 0 ? (
            <EmptyState
              title="No match results yet"
              description='Select a resume + jobs and click "Run Match".'
            />
          ) : (
            filteredResults.map((m) => {
              const badge = scoreLabel(m.score);

              const rawParsed =
                typeof m.missingSkillsParsed !== "undefined"
                  ? m.missingSkillsParsed
                  : (() => {
                      try {
                        return JSON.parse(m.missingSkills);
                      } catch {
                        return [];
                      }
                    })();

              const breakdown = parseBreakdown(rawParsed);
              const hasBreakdown = breakdown.overlapScore >= 0;

              return (
                <Card key={m.id}>
                  {/* Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">
                        {m.job?.title ?? "Job"}{" "}
                        <span className="text-neutral-400">→</span>{" "}
                        {m.resume?.fileName ?? "Resume"}
                      </div>
                      <div className="mt-1 text-xs text-neutral-500">
                        Overall score:{" "}
                        <span className="font-medium">{Math.round(m.score)}%</span>
                      </div>
                    </div>

                    <div className={`rounded-xl border px-3 py-1.5 text-xs font-medium ${badge.cls}`}>
                      {badge.label}
                    </div>
                  </div>

                  {/* Score breakdown bars */}
                  {hasBreakdown ? (
                    <div className="mt-4 space-y-2">
                      <div className="text-xs font-semibold text-neutral-600">Score breakdown</div>
                      <ScoreBar label="Skills match" value={breakdown.overlapScore} />
                      <ScoreBar label="Language fit" value={breakdown.semanticScore} />
                      <ScoreBar label="Overall" value={Math.round(m.score)} />
                    </div>
                  ) : null}

                  {/* Missing skills */}
                  <div className="mt-4">
                    <div className="text-xs font-semibold text-neutral-600">Missing skills</div>
                    {breakdown.missing.length === 0 ? (
                      <div className="mt-2 text-sm text-neutral-700">None detected 🎉</div>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {breakdown.missing.map((s) => (
                          <Tag key={s}>{s}</Tag>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Actionable tips */}
                  {breakdown.tips.length > 0 ? (
                    <div className="mt-4">
                      <div className="text-xs font-semibold text-neutral-600">
                        💡 How to improve your score
                      </div>
                      <ul className="mt-2 space-y-1.5">
                        {breakdown.tips.map((tip, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 text-sm text-neutral-700"
                          >
                            <span className="mt-0.5 shrink-0 text-neutral-400">•</span>
                            <span>{tip}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </Card>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
