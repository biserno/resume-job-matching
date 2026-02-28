import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const resumes = await prisma.resume.findMany({
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(resumes);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const fileName = String(body?.fileName ?? "").trim();
    const content = String(body?.content ?? "").trim();

    if (!fileName) {
      return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    }
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const resume = await prisma.resume.create({
      data: { fileName, content },
    });

    return NextResponse.json(resume, { status: 201 });
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
  await prisma.matchResult.deleteMany({ where: { resumeId: id } });
  await prisma.resume.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const id = Number(body?.id);
    const fileName = String(body?.fileName ?? "").trim();
    const content = String(body?.content ?? "").trim();

    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (!fileName) {
      return NextResponse.json({ error: "fileName is required" }, { status: 400 });
    }
    if (!content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    const updated = await prisma.resume.update({
      where: { id },
      data: { fileName, content },
    });

    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
}