"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Tag } from "@/components/Tag";

type ResumeRow = {
  id: number;
  fileName: string;
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


export default function ResumesPage() {
  const [items, setItems] = useState<ResumeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [skillsMap, setSkillsMap] = useState<Record<number, string[]>>({});

  const [fileName, setFileName] = useState("");
  const [content, setContent] = useState("");

  // modal state
  const [openResume, setOpenResume] = useState<ResumeRow | null>(null);
  const [editFileName, setEditFileName] = useState("");
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
      const res = await fetch("/api/resumes", { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as ResumeRow[];
      setItems(data);
      for (const item of data) {
        void extractSkillsForItem(item.id, item.content);
      }
    } catch (e: any) {
      setError(e?.message ?? "Failed to load resumes");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const canSave = useMemo(
    () => fileName.trim().length > 0 && content.trim().length > 0,
    [fileName, content]
  );

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave || saving) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/resumes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fileName: fileName.trim(),
          content: content.trim(),
        }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Failed to save resume");
      }

      setFileName("");
      setContent("");
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save resume");
    } finally {
      setSaving(false);
    }
  }

  async function onUpload(file: File) {
    if (uploading) return;

    setUploading(true);
    setError(null);

    try {
      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/resumes/upload", {
        method: "POST",
        body: fd,
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Upload failed");
      }

      await load();
    } catch (e: any) {
      setError(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function onDeleteResume(id: number) {
    const ok = confirm(
      "Delete this resume? This will also remove related match results."
    );
    if (!ok) return;

    setError(null);
    try {
      const res = await fetch(`/api/resumes?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Delete failed");
      }
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    }
  }

  function openEditor(r: ResumeRow) {
    setOpenResume(r);
    setEditFileName(r.fileName);
    setEditContent(r.content);
  }

  async function saveEdit() {
    if (!openResume) return;

    const fn = editFileName.trim();
    const ct = editContent.trim();

    if (!fn) {
      setError("File name cannot be empty.");
      return;
    }
    if (!ct) {
      setError("Content cannot be empty.");
      return;
    }

    setUpdating(true);
    setError(null);

    try {
      const res = await fetch("/api/resumes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: openResume.id,
          fileName: fn,
          content: ct,
        }),
      });

      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || "Update failed");
      }

      setOpenResume(null);
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
        title="Resumes"
      />

      {error ? (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <h2 className="text-sm font-semibold">Add Resume</h2>

          {/* Upload box */}
          <div className="mt-4 rounded-2xl border border-neutral-200 bg-neutral-50 p-4">
            <div className="text-sm font-semibold">Upload Resume</div>

            <input
              type="file"
              accept=".pdf,.docx,.txt"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onUpload(f);
                e.currentTarget.value = "";
              }}
              className="mt-3 w-full text-sm text-neutral-700
                         file:mr-4 file:rounded-xl file:border-0
                         file:bg-neutral-900 file:px-4 file:py-2
                         file:text-sm file:font-medium file:text-white
                         hover:file:bg-neutral-800
                         disabled:opacity-60 disabled:cursor-not-allowed"
            />

            <div className="mt-2 text-xs text-neutral-600">
              {uploading ? "Uploading…" : "Supported: PDF, DOCX, TXT"}
            </div>
          </div>

          {/* Paste form */}
          <form className="mt-5 space-y-3" onSubmit={onSave}>
            <div>
              <label className="text-xs text-neutral-600">File name</label>
              <input
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                placeholder="e.g., Resume.pdf"
              />
            </div>

            <div>
              <label className="text-xs text-neutral-600">Resume text</label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                className="mt-1 h-44 w-full rounded-xl border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-neutral-200"
                placeholder="Paste resume content here..."
              />
            </div>

            <button
              type="submit"
              disabled={!canSave || saving}
              className="w-full rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Resume"}
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
              title="No resumes yet"
              description="Upload a resume file or paste your first resume to start matching."
            />
          ) : (
            items.map((r) => {
              const skills = skillsMap[r.id] ?? [];
              return (
                <Card key={r.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{r.fileName}</div>
                      <div className="mt-1 text-xs text-neutral-500">
                        Added {formatDate(r.createdAt)}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEditor(r)}
                        className="rounded-xl border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-50"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteResume(r.id)}
                        className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  <p className="mt-3 text-sm text-neutral-700">{preview(r.content)}</p>

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
      {openResume ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-neutral-200 p-4">
              <div>
                <div className="text-sm font-semibold">Resume</div>
              </div>
            </div>

            <div className="space-y-3 p-4">
              <div>
                <label className="text-xs text-neutral-600">File name</label>
                <input
                  value={editFileName}
                  onChange={(e) => setEditFileName(e.target.value)}
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
                onClick={() => setOpenResume(null)}
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