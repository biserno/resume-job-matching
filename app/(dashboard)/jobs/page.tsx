"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Tag } from "@/components/Tag";

type JobRow = {
  id: number;
  title: string;
  content: string;
  createdAt: string;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString();
}

function preview(text: string, max = 140) {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + "…";
}


export default function JobsPage() {
  const [items, setItems] = useState<JobRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillsMap, setSkillsMap] = useState<Record<number, string[]>>({});

  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  // modal state
  const [openJob, setOpenJob] = useState<JobRow | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");

  async function extractSkillsForItem(id: number, text: string) {
    try {
      const res = await fetch("/api/extract-skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const data = await res.json();
        setSkillsMap((prev) => ({ ...prev, [id]: data.skillsPretty ?? [] }));
      }
    } catch {
      // skill extraction is best-effort for the UI preview
    }
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/jobs", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as JobRow[];
      setItems(data);
      for (const item of data) {
        void extractSkillsForItem(item.id, `${item.title}\n${item.content}`);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load jobs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const canSave = useMemo(
    () => title.trim().length > 0 && content.trim().length > 0,
    [title, content]
  );

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || saving) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Failed to save job");
      }

      setTitle("");
      setContent("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save job");
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteJob(id: number) {
    const ok = confirm("Delete this job? This will also remove related match results.");
    if (!ok) return;

    setError(null);
    try {
      const res = await fetch(`/api/jobs?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Delete failed");
      }
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    }
  }

  function openEditor(j: JobRow) {
    setOpenJob(j);
    setEditTitle(j.title);
    setEditContent(j.content);
  }

  async function saveEdit() {
    if (!openJob) return;

    const t = editTitle.trim();
    const c = editContent.trim();

    if (!t) {
      setError("Title cannot be empty.");
      return;
    }
    if (!c) {
      setError("Content cannot be empty.");
      return;
    }

    setUpdating(true);
    setError(null);

    try {
      const res = await fetch("/api/jobs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: openJob.id,
          title: t,
          content: c,
        }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Update failed");
      }

      setOpenJob(null);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Update failed");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Job Descriptions"
      />

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold">Add Job</h2>

          <form className="mt-4 space-y-3" onSubmit={onSave}>
            <div>
              <label className="text-xs text-neutral-600">Job title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                placeholder="e.g., Senior C# Developer"
              />
            </div>

            <div>
              <label className="text-xs text-neutral-600">Job description</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="mt-1 h-44 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                placeholder="Paste job description here..."
              />
            </div>

            <button
              type="submit"
              disabled={!canSave || saving}
              className="w-full rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Job"}
            </button>
          </form>
        </Card>

        <div className="space-y-4">
          {loading ? (
            <Card>
              <div className="text-sm text-neutral-600">Loading…</div>
            </Card>
          ) : items.length === 0 ? (
            <EmptyState
              title="No jobs yet"
              description="Add your first job description to start matching."
            />
          ) : (
            items.map((j) => {
              const skills = skillsMap[j.id] ?? [];
              return (
                <Card key={j.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{j.title}</div>
                      <div className="mt-1 text-xs text-neutral-500">
                        Added {formatDate(j.createdAt)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditor(j)}
                        className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteJob(j.id)}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <p className="mt-3 text-sm text-neutral-700">{preview(j.content)}</p>

                  {skills.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {skills.map((s) => (
                        <Tag key={s}>{s}</Tag>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 text-xs text-neutral-500">
                      Extracting skills…
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      </div>

      {/* Modal: Preview/Edit */}
      {openJob ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-200 p-4">
              <div>
                <div className="text-sm font-semibold">Job</div>
              </div>
            </div>

            <div className="space-y-3 p-4">
              <div>
                <label className="text-xs text-neutral-600">Title</label>
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm"
                />
              </div>

              <div>
                <label className="text-xs text-neutral-600">Content</label>
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="mt-1 h-80 w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-neutral-200 p-4">
              <button
                type="button"
                onClick={() => setOpenJob(null)}
                className="rounded-xl border border-neutral-300 bg-white px-4 py-2 text-sm font-medium hover:bg-neutral-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={updating}
                onClick={() => void saveEdit()}
                className="rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-60"
              >
                {updating ? "Saving…" : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}