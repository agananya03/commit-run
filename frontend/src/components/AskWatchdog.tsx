"use client";

import React, { useState } from "react";
import { api, AskResponse } from "@/lib/api";
import { useEvidencePanel } from "@/components/EvidencePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MessageSquareText, ShieldAlert, Sparkles, Send, CheckCircle2, XCircle, Search, ExternalLink } from "lucide-react";

interface AskWatchdogProps {
  proposalId: string;
}

export function AskWatchdog({ proposalId }: AskWatchdogProps) {
  const { openChunk } = useEvidencePanel();
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [response, setResponse] = useState<AskResponse | null>(null);

  const handleAsk = async (qToAsk?: string) => {
    const q = (qToAsk || question).trim();
    if (!q) return;
    if (qToAsk) setQuestion(qToAsk);

    setLoading(true);
    try {
      const res = await api.askQuestion(proposalId, q);
      setResponse(res);
    } catch {
      setResponse({
        proposalId,
        question: q,
        answer: "Refused: Insufficient verified evidence in proposal documentation to answer this question.",
        citations: [],
        refused: true,
      });
    } finally {
      setLoading(false);
    }
  };

  const sampleQuestions = proposalId === "MIP-21" 
    ? [
        "What gas optimisation does VaultV2 implement?",
        "Is there any change to ownership?",
        "What is the astronaut training schedule?",
      ]
    : [
        "What is the USDC allocation requested for Phase 1?",
        "What is the total budget requested?",
        "Who is the CEO of SpaceX?",
      ];

  return (
    <Card className="border border-border/80 bg-card/60 backdrop-blur-sm shadow-md mt-6">
      <CardHeader className="pb-3 border-b border-border/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-md bg-accent/15 text-accent border border-accent/30">
              <MessageSquareText className="h-4 w-4" />
            </div>
            <div>
              <CardTitle className="text-base font-semibold tracking-tight text-foreground flex items-center gap-2">
                Ask Watchdog (POST /ask)
                <Badge variant="outline" className="text-[10px] font-mono border-accent/40 text-accent">
                  Verified Citations Only
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Strict retrieval-grounded Q&A that explicitly refuses when evidence is missing.
              </p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {/* Input box */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAsk()}
              placeholder="Ask a question about this proposal (e.g. allocation, ownership, gas)..."
              className="pl-9 text-sm bg-background/80 border-border/70 focus-visible:ring-accent"
              disabled={loading}
            />
          </div>
          <Button
            onClick={() => handleAsk()}
            disabled={loading || !question.trim()}
            className="bg-accent text-accent-foreground hover:bg-accent/90 shrink-0 gap-1.5 px-4"
          >
            {loading ? (
              <span className="animate-spin inline-block h-3.5 w-3.5 border-2 border-current border-t-transparent rounded-full" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            <span>Ask</span>
          </Button>
        </div>

        {/* Quick sample chips */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground font-medium">Try:</span>
          {sampleQuestions.map((q, idx) => (
            <button
              key={idx}
              onClick={() => handleAsk(q)}
              disabled={loading}
              className={`px-2.5 py-1 rounded-full border text-[11px] transition-colors ${
                idx === sampleQuestions.length - 1
                  ? "border-amber-500/40 text-amber-300 hover:bg-amber-500/10"
                  : "border-border/60 text-muted-foreground hover:text-foreground hover:border-accent/50 hover:bg-accent/5"
              }`}
            >
              {q}
              {idx === sampleQuestions.length - 1 && " (refusal test)"}
            </button>
          ))}
        </div>

        {/* Response view */}
        {response && (
          <div
            className={`p-4 rounded-lg border text-sm transition-all ${
              response.refused
                ? "bg-amber-950/20 border-amber-600/40 text-amber-200"
                : "bg-emerald-950/20 border-emerald-600/40 text-emerald-100"
            }`}
          >
            <div className="flex items-start gap-2.5">
              {response.refused ? (
                <XCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0 mt-0.5" />
              )}
              <div className="space-y-2 flex-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs uppercase tracking-wider opacity-80">
                    {response.refused ? "Verification Refusal" : "Verified Answer"}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] uppercase font-mono ${
                      response.refused
                        ? "border-amber-500/50 text-amber-300 bg-amber-500/10"
                        : "border-emerald-500/50 text-emerald-300 bg-emerald-500/10"
                    }`}
                  >
                    {response.refused ? "Missing Evidence" : `${response.citations.length} Verified Citation(s)`}
                  </Badge>
                </div>

                <p className="leading-relaxed text-sm">{response.answer}</p>

                {response.citations && response.citations.length > 0 && (
                  <div className="pt-2 border-t border-border/30 space-y-1.5">
                    <span className="text-[11px] text-muted-foreground block font-medium">
                      Exact Substring Citations:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {response.citations.map((c, i) => (
                        <button
                          key={i}
                          onClick={() => openChunk(c.chunkId)}
                          className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-background/60 hover:bg-background border border-border/60 hover:border-accent text-xs font-mono text-muted-foreground hover:text-foreground transition-colors group"
                        >
                          <span className="text-accent group-hover:underline">{c.chunkId}</span>
                          <ExternalLink className="h-3 w-3 opacity-60 group-hover:opacity-100" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
