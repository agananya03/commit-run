import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function GET(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  const { slug } = params;

  // Resolve /shared/mocks path upwards from project root
  const candidateDirs = [
    path.resolve(process.cwd(), "../shared/mocks"),
    path.resolve(process.cwd(), "shared/mocks"),
    path.resolve(process.cwd(), "../../shared/mocks"),
  ];

  let mocksDir = candidateDirs[0];
  for (const dir of candidateDirs) {
    if (fs.existsSync(dir)) {
      mocksDir = dir;
      break;
    }
  }

  const filePath = path.join(mocksDir, slug);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json(
      { error: `Mock file ${slug} not found in ${mocksDir}` },
      { status: 404 }
    );
  }

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return NextResponse.json(JSON.parse(content));
  } catch (err: any) {
    return NextResponse.json(
      { error: `Failed to read mock file: ${err.message}` },
      { status: 500 }
    );
  }
}
