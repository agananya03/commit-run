import { Router, type Request } from "express";
import multer from "multer";
import { z } from "zod";
import { CreateProposalRequest } from "../contracts/schemas.js";
import { EVIDENCE_TYPES, type ProposalService, type Upload } from "../proposals/service.js";
import type { EvidenceType } from "../seed/scenarios.js";

/** One file per evidence type; the form field name is the type (forum, pdf, social, onchain, disclosure). */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: EVIDENCE_TYPES.length },
}).fields(EVIDENCE_TYPES.map((name) => ({ name, maxCount: 1 })));

const UploadMeta = z.strictObject({ slug: z.string(), title: z.string().min(1), proposer: z.string() });

function uploadsOf(req: Request): Upload[] {
  const files = (req.files ?? {}) as Record<string, Express.Multer.File[]>;
  return Object.entries(files).flatMap(([type, list]) =>
    list.map((f) => ({ type: type as EvidenceType, originalName: f.originalname, bytes: f.buffer })),
  );
}

const isMultipart = (req: Request): boolean => Boolean(req.is("multipart/form-data"));

/** :id is a slug (MIP-21) or a database id. */
const idParam = (req: Request): string => z.string().min(1).parse(req.params.id);

export function proposalRoutes(service: ProposalService): Router {
  const router = Router();

  router.get("/proposals", async (_req, res) => {
    res.json(await service.list());
  });

  router.post("/proposals", upload, async (req, res) => {
    const bundle = isMultipart(req)
      ? await service.createFromUpload(UploadMeta.parse(req.body), uploadsOf(req))
      : await service.createFromScenario(CreateProposalRequest.parse(req.body).slug);
    res.status(201).json(bundle);
  });

  router.get("/proposals/:id", async (req, res) => {
    res.json(await service.getBundle(idParam(req)));
  });

  router.post("/proposals/:id/versions", upload, async (req, res) => {
    res.status(201).json(await service.addVersion(idParam(req), isMultipart(req) ? uploadsOf(req) : []));
  });

  return router;
}
