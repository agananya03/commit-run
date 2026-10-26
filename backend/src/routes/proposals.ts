import { Router, type Request } from "express";
import multer from "multer";
import { z } from "zod";
import { CreateProposalRequest } from "../contracts/schemas.js";
import { HttpError } from "../errors.js";
import type { Reverifier } from "../integrity/reverify.js";
import type { Pipeline } from "../pipeline/pipeline.js";
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

export function proposalRoutes(service: ProposalService, pipeline?: Pipeline, reverifier?: Reverifier): Router {
  const router = Router();

  router.post("/proposals/:id/run", async (req, res) => {
    if (!pipeline) throw new HttpError(502, "UPSTREAM_UNAVAILABLE", "Pipeline (Redis) is not configured for this backend");
    res.status(202).json(await pipeline.run(idParam(req), { force: req.query.force === "true" }));
  });

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

  // The technical assessment whose sha256 is attested in ProposalRegistry; anyone can re-hash it.
  router.get("/proposals/:id/assessment", async (req, res) => {
    const simHash = typeof req.query.simHash === "string" ? req.query.simHash : undefined;
    const { markdown, reportHash } = await service.assessment(idParam(req), simHash);
    res.type("text/markdown; charset=utf-8").set("X-Report-Hash", reportHash).send(markdown);
  });

  router.post("/proposals/:id/commit", async (req, res) => {
    res.json(await service.commit(idParam(req)));
  });

  router.post("/proposals/:id/reverify", async (req, res) => {
    if (!reverifier) throw new HttpError(502, "UPSTREAM_UNAVAILABLE", "Reverify needs the chain and the sim; they are not configured for this backend");
    res.json(await reverifier.reverify(idParam(req)));
  });

  router.post("/proposals/:id/disclosure", async (req, res) => {
    res.status(201).json(await service.addDisclosure(idParam(req), req.body));
  });

  router.post("/proposals/:id/versions", upload, async (req, res) => {
    res.status(201).json(await service.addVersion(idParam(req), isMultipart(req) ? uploadsOf(req) : []));
  });

  return router;
}
