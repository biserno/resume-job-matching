import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs"; // needed for FormData + file handling reliably

export async function POST(req: Request) {
  try {
    const nlpUrl = process.env.NLP_SERVICE_URL;
    if (!nlpUrl) {
      return NextResponse.json(
        { error: "NLP_SERVICE_URL is not set" },
        { status: 500 }
      );
    }

    const form = await req.formData();
    const file = form.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }

    // Forward file to Python /parse
    const pyForm = new FormData();
    pyForm.append("file", file, file.name);

    const pyRes = await fetch(`${nlpUrl.replace(/\/$/, "")}/parse`, {
      method: "POST",
      body: pyForm,
    });

    if (!pyRes.ok) {
      const text = await pyRes.text().catch(() => "");
      return NextResponse.json(
        { error: "Python parse error", details: text || pyRes.statusText },
        { status: 502 }
      );
    }

    const parsed = (await pyRes.json()) as { fileName: string; text: string };

    const resume = await prisma.resume.create({
      data: {
        fileName: parsed.fileName || file.name || "upload",
        content: parsed.text,
      },
    });

    return NextResponse.json(resume, { status: 201 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "Upload failed" },
      { status: 400 }
    );
  }
}