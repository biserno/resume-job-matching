import { NextResponse } from "next/server";

type ExtractSkillsResponse = {
  skills: string[];
  skillsPretty: string[];
  count: number;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const text = String(body?.text ?? "").trim();

    if (!text) {
      return NextResponse.json({ error: "text is required" }, { status: 400 });
    }

    const nlpUrl = process.env.NLP_SERVICE_URL;
    if (!nlpUrl) {
      return NextResponse.json(
        { error: "NLP_SERVICE_URL is not set" },
        { status: 500 },
      );
    }

    const pyRes = await fetch(`${nlpUrl.replace(/\/$/, "")}/extract_skills`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!pyRes.ok) {
      const detail = await pyRes.text().catch(() => "");
      return NextResponse.json(
        { error: "NLP service error", details: detail || pyRes.statusText },
        { status: 502 },
      );
    }

    const data = (await pyRes.json()) as ExtractSkillsResponse;
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
