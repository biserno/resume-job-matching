import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const jobs = await prisma.jobDescription.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(jobs);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const title = String(body?.title ?? "").trim();
    const content = String(body?.content ?? "").trim();

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const job = await prisma.jobDescription.create({
      data: { title, content },
    });

    return NextResponse.json(job, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const idRaw = url.searchParams.get("id");
  const id = Number(idRaw);

  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "id query param is required" }, { status: 400 });
  }

  // delete dependent match results first to avoid FK issues
  await prisma.matchResult.deleteMany({ where: { jobId: id } });
  await prisma.jobDescription.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const id = Number(body?.id);
    const title = String(body?.title ?? "").trim();
    const content = String(body?.content ?? "").trim();

    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const updated = await prisma.jobDescription.update({
      where: { id },
      data: { title, content },
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}