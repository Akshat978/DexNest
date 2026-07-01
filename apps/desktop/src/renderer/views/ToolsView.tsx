import React, { useState, useEffect } from "react";
import { ArrowRight, AudioLines, FileAudio, FileImage, FileStack, FileText, FileType2, FolderOpen, Images, ScanText, Scissors, Share2, Sparkles, Trash2, UploadCloud, Vault, Wrench, type LucideIcon } from "lucide-react";
import { GlassCard, SectionTitle } from "../components/ui/GlassCard";
import { StatusChip } from "../components/ui/StatusChip";
import { ProgressRing } from "../components/ui/ProgressRing";
import { ActionButton } from "../components/ui/ActionButton";
import { Spinner, ToastStack, LimitedList } from "../components/shared";
import { getBridge } from "../lib/bridge";
import { formatBytes, formatDate } from "../lib/format";
import type { ToolsState, ToolsOutputItem, ToolsSelectedFile, PdfInfoItem } from "../main";

export function ToolsView({
  toolsState,
  onAction,
  onRefresh
}: {
  toolsState: ToolsState;
  onAction: (actionId: string, source?: string, params?: unknown) => Promise<{
    ok: boolean;
    error?: string;
    outputs?: ToolsOutputItem[];
    output?: string | ToolsOutputItem;
    info?: PdfInfoItem[];
    ocrPreview?: string;
    ocrMetadata?: { engine: string; averageConfidence: number | null };
  }>;
  onRefresh: () => Promise<void>;
}) {
  const [selectedFiles, setSelectedFiles] = useState<ToolsSelectedFile[]>([]);
  const [pdfInfo, setPdfInfo] = useState<PdfInfoItem[]>([]);
  const [pageRange, setPageRange] = useState("1");
  const [imageFormat, setImageFormat] = useState("jpg");
  const [imageQuality, setImageQuality] = useState("80");
  const [audioFormat, setAudioFormat] = useState("mp3");
  const [resizeWidth, setResizeWidth] = useState("");
  const [resizeHeight, setResizeHeight] = useState("");
  const [activeTab, setActiveTab] = useState<"pdf" | "images" | "ocr" | "media" | "office" | "outputs" | "settings">("pdf");
  const [ocrEngine, setOcrEngine] = useState<"tesseract" | "paddleocr" | "easyocr_placeholder">(toolsState.ocrEngine ?? "paddleocr");
  const [ocrDevice, setOcrDevice] = useState<"gpu" | "cpu">(toolsState.ocrDevice ?? "gpu");
  const [ocrLanguage, setOcrLanguage] = useState(toolsState.ocrLanguage ?? "eng");
  const [ocrPreview, setOcrPreview] = useState("");
  const [ocrMetadata, setOcrMetadata] = useState<{ engine: string; averageConfidence: number | null } | null>(null);
  const [ocrUpscale, setOcrUpscale] = useState(true);
  const [ocrThreshold, setOcrThreshold] = useState(false);
  const [scanGrayscale, setScanGrayscale] = useState(true);
  const [scanSharpen, setScanSharpen] = useState(true);
  const [scanContrast, setScanContrast] = useState("0.28");
  const [scanRotate, setScanRotate] = useState("0");
  const [status, setStatus] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [runningActionId, setRunningActionId] = useState<string | null>(null);
  const [draggedFileIndex, setDraggedFileIndex] = useState<number | null>(null);
  const [selectedToolId, setSelectedToolId] = useState("tools.ocr_image");

  const selectedPaths = selectedFiles.map((file) => file.path);

  useEffect(() => {
    setOcrEngine(toolsState.ocrEngine ?? "paddleocr");
    setOcrDevice(toolsState.ocrDevice ?? "gpu");
    setOcrLanguage(toolsState.ocrLanguage ?? "eng");
  }, [toolsState.ocrEngine, toolsState.ocrDevice, toolsState.ocrLanguage]);

  function showStatus(message: string, tone: "success" | "error" = "success"): void {
    setStatus({ tone, message });
    window.setTimeout(() => {
      setStatus((current) => current?.message === message ? null : current);
    }, 3000);
  }

  async function selectFiles(kind: "pdf" | "image" | "any"): Promise<void> {
    const files = await getBridge().selectToolsFiles(kind);
    setSelectedFiles(files);
    if (kind === "pdf" || files.some((file) => file.extension === ".pdf")) {
      setPdfInfo(await getBridge().getPdfInfo(files.filter((file) => file.extension === ".pdf").map((file) => file.path)));
    } else {
      setPdfInfo([]);
    }
  }

  function onDrop(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault();
    if (draggedFileIndex !== null || event.dataTransfer.types.includes("application/x-dexnest-tools-reorder")) {
      return;
    }
    if (event.dataTransfer.files.length === 0) {
      return;
    }

    const files = Array.from(event.dataTransfer.files).map((file) => ({
      path: (file as File & { path?: string }).path ?? "",
      name: file.name,
      byteLength: file.size,
      extension: `.${file.name.split(".").pop()?.toLowerCase() ?? ""}`
    })).filter((file) => file.path);
    setSelectedFiles(files);
    void getBridge().getPdfInfo(files.filter((file) => file.extension === ".pdf").map((file) => file.path)).then(setPdfInfo);
  }

  async function updateFileOrder(files: ToolsSelectedFile[]): Promise<void> {
    setSelectedFiles(files);
    setPdfInfo(await getBridge().getPdfInfo(files.filter((file) => file.extension === ".pdf").map((file) => file.path)));
  }

  function reorderSelectedFile(targetIndex: number): void {
    if (draggedFileIndex === null || draggedFileIndex === targetIndex) {
      return;
    }

    const nextFiles = [...selectedFiles];
    const [file] = nextFiles.splice(draggedFileIndex, 1);
    nextFiles.splice(targetIndex, 0, file);
    setDraggedFileIndex(targetIndex);
    void updateFileOrder(nextFiles);
  }

  async function runTool(actionId: string, params: Record<string, unknown> = {}): Promise<void> {
    setRunningActionId(actionId);
    try {
      const result = await onAction(actionId, "module_ui", { paths: selectedPaths, ...params });

      if (result.ok) {
        const count = result.outputs?.length ?? (result.output ? 1 : 0);
        if (result.ocrPreview !== undefined) {
          setOcrPreview(result.ocrPreview || "OCR completed but no preview text was extracted.");
          setOcrMetadata(result.ocrMetadata ?? null);
        }
        showStatus(count ? `Created ${count} output file${count === 1 ? "" : "s"}.` : "Tools action completed.");
        await onRefresh();
      } else {
        showStatus(result.error ?? "Tools action failed.", "error");
      }
    } catch (error) {
      showStatus(error instanceof Error ? error.message : "Tools action failed.", "error");
    } finally {
      setRunningActionId(null);
    }
  }

  async function sendOutputToDrop(output: ToolsOutputItem): Promise<void> {
    const result = await onAction("tools.send_output_to_drop", "module_ui", { path: output.path });
    showStatus(result.ok ? "Output sent to phone." : result.error ?? "Send to phone failed.", result.ok ? "success" : "error");
  }

  async function saveOutputToVault(output: ToolsOutputItem): Promise<void> {
    const result = await onAction("tools.save_output_to_vault", "module_ui", {
      path: output.path,
      category: "Other",
      tags: "tools",
      sourceModule: "DexNest Tools",
      title: output.fileName
    });
    showStatus(result.ok ? "Output saved to Vault." : result.error ?? "Save to Vault failed.", result.ok ? "success" : "error");
    await onRefresh();
  }

  const ACCENT_TOOLS = "#F97316";
  const TOOL_CATS: Array<{ label: string; tools: Array<{ id: string; name: string; icon: LucideIcon; desc: string; fmt: string; out: string; kind: "pdf" | "image" | "any" }> }> = [
    { label: "PDF tools", tools: [
      { id: "tools.merge_pdfs", name: "Merge PDF", icon: FileStack, desc: "Combine multiple PDFs", fmt: "PDF", out: "PDF", kind: "pdf" },
      { id: "tools.split_pdf", name: "Split PDF", icon: Scissors, desc: "Extract selected pages", fmt: "PDF", out: "PDF", kind: "pdf" },
      { id: "tools.pdf_to_text", name: "PDF → text", icon: FileText, desc: "Extract text from a PDF", fmt: "PDF", out: "TXT", kind: "pdf" },
      { id: "tools.pdf_to_docx_experimental", name: "PDF → DOCX", icon: FileType2, desc: "Convert a PDF to Word", fmt: "PDF", out: "DOCX", kind: "pdf" }
    ] },
    { label: "OCR / Scan", tools: [
      { id: "tools.ocr_image", name: "OCR Image", icon: ScanText, desc: "Extract text locally", fmt: "PNG · JPG", out: "TXT", kind: "image" },
      { id: "tools.ocr_pdf", name: "OCR PDF", icon: ScanText, desc: "Make scans searchable", fmt: "PDF", out: "PDF", kind: "pdf" },
      { id: "tools.clean_scan", name: "Clean Scan", icon: Sparkles, desc: "Enhance scanned docs", fmt: "PNG · JPG", out: "IMG", kind: "image" }
    ] },
    { label: "Images", tools: [
      { id: "tools.images_to_pdf", name: "Images → PDF", icon: FileImage, desc: "Bundle images to PDF", fmt: "PNG · JPG", out: "PDF", kind: "image" },
      { id: "tools.convert_image", name: "Convert image", icon: FileImage, desc: "Change image format", fmt: "PNG · JPG · WEBP", out: "IMG", kind: "image" },
      { id: "tools.compress_image", name: "Compress image", icon: FileImage, desc: "Shrink image size", fmt: "PNG · JPG", out: "JPG", kind: "image" },
      { id: "tools.resize_image", name: "Resize image", icon: FileImage, desc: "Resize to width / height", fmt: "PNG · JPG", out: "IMG", kind: "image" }
    ] },
    { label: "Media", tools: [
      { id: "tools.pdf_to_images", name: "PDF → Images", icon: Images, desc: "Export pages as images", fmt: "PDF", out: "PNG", kind: "pdf" },
      { id: "tools.mp4_to_mp3", name: "MP4 → MP3", icon: FileAudio, desc: "Extract audio track", fmt: "MP4 · MOV", out: "MP3", kind: "any" },
      { id: "tools.extract_audio", name: "Extract audio", icon: FileAudio, desc: "Audio track from video", fmt: "MP4 · MOV", out: "MP3 · WAV", kind: "any" },
      { id: "tools.convert_audio", name: "Convert audio", icon: AudioLines, desc: "Change audio format", fmt: "MP3 · WAV · AAC", out: "AUDIO", kind: "any" }
    ] },
    { label: "Office", tools: [
      { id: "tools.docx_to_pdf", name: "DOCX → PDF", icon: FileType2, desc: "Convert office docs", fmt: "DOCX", out: "PDF", kind: "any" },
      { id: "tools.pptx_to_pdf", name: "PPTX → PDF", icon: FileType2, desc: "Convert slides", fmt: "PPTX", out: "PDF", kind: "any" },
      { id: "tools.pptx_to_images", name: "PPTX → images", icon: Images, desc: "Slides to images", fmt: "PPTX", out: "PNG", kind: "any" }
    ] }
  ];
  const allTools = TOOL_CATS.flatMap((c) => c.tools);
  const selectedTool = allTools.find((t) => t.id === selectedToolId) ?? allTools[0];
  const toolParams = (id: string): Record<string, unknown> => {
    if (id === "tools.split_pdf") return { range: pageRange };
    if (id === "tools.ocr_image" || id === "tools.ocr_pdf") return { engine: ocrEngine, device: ocrDevice, language: ocrLanguage, upscale: ocrUpscale, grayscale: scanGrayscale, contrastBoost: true, sharpen: scanSharpen, threshold: ocrThreshold, rotateDegrees: scanRotate };
    if (id === "tools.clean_scan") return { grayscale: scanGrayscale, sharpen: scanSharpen, contrast: scanContrast, rotateDegrees: scanRotate };
    if (id === "tools.mp4_to_mp3") return { format: "mp3" };
    if (id === "tools.convert_image") return { format: imageFormat, quality: imageQuality };
    if (id === "tools.compress_image") return { format: "jpg", quality: imageQuality };
    if (id === "tools.resize_image") return { format: imageFormat, quality: imageQuality, width: resizeWidth, height: resizeHeight };
    if (id === "tools.extract_audio" || id === "tools.convert_audio") return { format: audioFormat };
    return {};
  };
  const latestOutput = toolsState.outputs[0];

  return (
    <div className="space-y-6">
      {status && (<ToastStack toasts={[{ id: status.message, message: status.message, tone: status.tone }]} />)}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border" style={{ borderColor: `${ACCENT_TOOLS}40`, background: `${ACCENT_TOOLS}14`, color: ACCENT_TOOLS }}>
            <Wrench className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#F5F5F5]">Tools</h1>
            <p className="text-sm text-[#A3A3A3]">Offline PDF, OCR &amp; media workstation — runs entirely on-device</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusChip tone="ok" dot={false} style={{ color: ACCENT_TOOLS, borderColor: `${ACCENT_TOOLS}33`, background: `${ACCENT_TOOLS}12` }}>PaddleOCR {toolsState.ocrEngine === "paddleocr" ? "ready" : "available"}</StatusChip>
          <StatusChip tone="info">Tesseract fallback</StatusChip>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Tool grid */}
        <div className="space-y-4 lg:col-span-7">
          {TOOL_CATS.map((cat) => (
            <div key={cat.label}>
              <SectionTitle>{cat.label}</SectionTitle>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {cat.tools.map((t) => {
                  const Icon = t.icon;
                  const active = selectedTool.id === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => setSelectedToolId(t.id)} className={`glass-card flex items-start gap-3 p-3 text-left transition-colors ${active ? "border-[#F97316]/40 bg-[#F97316]/[0.06]" : ""}`}>
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: `${ACCENT_TOOLS}16`, color: ACCENT_TOOLS }}><Icon className="h-[18px] w-[18px]" /></div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#F5F5F5]">{t.name}</p>
                        <p className="truncate text-xs text-[#A3A3A3]">{t.desc}</p>
                        <p className="mt-0.5 font-mono text-[9px] text-[#525252]">{t.fmt} → {t.out}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Work area + queue */}
        <div className="space-y-5 lg:col-span-5">
          <GlassCard accent={ACCENT_TOOLS} hover={false}>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2"><selectedTool.icon className="h-4 w-4" style={{ color: ACCENT_TOOLS }} /><span className="text-sm font-medium text-[#F5F5F5]">{selectedTool.name}</span></div>
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-[#A3A3A3]">{selectedTool.fmt} <ArrowRight className="h-3 w-3 text-[#525252]" /> {selectedTool.out}</span>
            </div>
            <section className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#262626] bg-[#0a0a0a] px-4 py-6 text-center transition-colors hover:border-[#F97316]/50" onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
              <UploadCloud className="h-7 w-7 text-[#F97316]" />
              <p className="mt-2 text-sm text-[#F5F5F5]">Drop files for <span className="font-medium">{selectedTool.name}</span></p>
              <p className="text-[11px] text-[#525252]">accepts {selectedTool.fmt}</p>
              <button type="button" onClick={() => void selectFiles(selectedTool.kind)} className="tools-action-button tools-action-button--outline mt-2">Choose files</button>
              {selectedFiles.length > 0 && <p className="mt-2 font-mono text-[10px] text-[#A3A3A3]">{selectedFiles.length} file{selectedFiles.length === 1 ? "" : "s"} selected</p>}
            </section>

            {/* Selected files — drag to reorder (matters for Merge PDF & Images → PDF). */}
            {selectedFiles.length > 0 && (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] text-[#A3A3A3]">Selected files{selectedFiles.length > 1 ? " · drag to reorder" : ""}</span>
                  <button type="button" onClick={() => setSelectedFiles([])} className="font-mono text-[10px] text-[#525252] hover:text-[#A3A3A3]">clear</button>
                </div>
                <div className="file-list">
                  {selectedFiles.map((file, index) => (
                    <div className="file-row" data-dragging={draggedFileIndex === index} draggable key={file.path}
                      onDragStart={(event) => { event.stopPropagation(); setDraggedFileIndex(index); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-dexnest-tools-reorder", String(index)); }}
                      onDragOver={(event) => { event.preventDefault(); reorderSelectedFile(index); }}
                      onDragEnd={() => setDraggedFileIndex(null)}>
                      <span><span className="font-mono text-[10px] text-[#525252]">{index + 1}.</span> {file.name}</span>
                      <span className="flex items-center gap-2">
                        <strong className="technical">{formatBytes(file.byteLength)}</strong>
                        <button type="button" title="Remove file" onClick={() => setSelectedFiles((current) => current.filter((_, i) => i !== index))} className="min-h-0 border-0 bg-transparent px-1 text-[#A3A3A3] hover:text-[#EF4444]">✕</button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* tool-specific options */}
            {selectedTool.id === "tools.split_pdf" && (
              <label className="mt-3 block text-xs text-[#A3A3A3]">Page range<input className="technical mt-1" value={pageRange} onChange={(event) => setPageRange(event.target.value)} placeholder="1-3,5" /></label>
            )}
            {(selectedTool.id === "tools.ocr_image" || selectedTool.id === "tools.ocr_pdf") && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-xs text-[#A3A3A3]">Engine<select className="mt-1" value={ocrEngine} onChange={(event) => setOcrEngine(event.target.value as typeof ocrEngine)}><option value="paddleocr">paddleocr</option><option value="tesseract">tesseract</option></select></label>
                <label className="text-xs text-[#A3A3A3]">Device<select className="mt-1" value={ocrDevice} onChange={(event) => setOcrDevice(event.target.value as typeof ocrDevice)}><option value="gpu">gpu</option><option value="cpu">cpu</option></select></label>
              </div>
            )}
            {selectedTool.id === "tools.clean_scan" && (
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-[#A3A3A3]">
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={scanGrayscale} onChange={(event) => setScanGrayscale(event.target.checked)} />Grayscale</label>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={scanSharpen} onChange={(event) => setScanSharpen(event.target.checked)} />Sharpen</label>
              </div>
            )}
            {(selectedTool.id === "tools.convert_image" || selectedTool.id === "tools.compress_image" || selectedTool.id === "tools.resize_image") && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                {selectedTool.id !== "tools.compress_image" && (
                  <label className="text-xs text-[#A3A3A3]">Format<select className="mt-1" value={imageFormat} onChange={(event) => setImageFormat(event.target.value)}><option value="jpg">jpg</option><option value="png">png</option><option value="webp">webp</option></select></label>
                )}
                <label className="text-xs text-[#A3A3A3]">Quality<input className="mt-1" value={imageQuality} onChange={(event) => setImageQuality(event.target.value)} placeholder="80" /></label>
                {selectedTool.id === "tools.resize_image" && (<>
                  <label className="text-xs text-[#A3A3A3]">Width<input className="mt-1" value={resizeWidth} onChange={(event) => setResizeWidth(event.target.value)} placeholder="px" /></label>
                  <label className="text-xs text-[#A3A3A3]">Height<input className="mt-1" value={resizeHeight} onChange={(event) => setResizeHeight(event.target.value)} placeholder="px" /></label>
                </>)}
              </div>
            )}
            {(selectedTool.id === "tools.extract_audio" || selectedTool.id === "tools.convert_audio") && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <label className="text-xs text-[#A3A3A3]">Audio format<select className="mt-1" value={audioFormat} onChange={(event) => setAudioFormat(event.target.value)}><option value="mp3">mp3</option><option value="wav">wav</option><option value="aac">aac</option></select></label>
              </div>
            )}

            <button type="button" disabled={runningActionId === selectedTool.id || selectedFiles.length === 0} onClick={() => void runTool(selectedTool.id, toolParams(selectedTool.id))} className="tools-action-button tools-action-button--primary mt-3 w-full">
              {runningActionId === selectedTool.id ? <><Spinner size="sm" /> Running…</> : <>Run {selectedTool.name}</>}
            </button>
          </GlassCard>

          <GlassCard hover={false}>
            <SectionTitle action={
              <span className="flex items-center gap-2">
                {toolsState.outputs.length > 0 && (
                  <button type="button" onClick={() => void (async () => { if (!window.confirm("Clear the Tools output list? Files on disk are kept.")) { return; } const r = await onAction("tools.clear_outputs", "module_ui", {}) as { ok?: boolean }; if (r.ok) { await onRefresh(); } })()} className="font-mono text-[10px] text-[#525252] hover:text-[#A3A3A3]">Clear</button>
                )}
                <StatusChip tone={runningActionId ? "running" : "ok"}>{runningActionId ? "running" : `${toolsState.outputs.length} outputs`}</StatusChip>
              </span>
            }>Job Queue</SectionTitle>
            <div className="space-y-2">
              {runningActionId && (
                <div className="glass-card flex items-center gap-3 p-2.5">
                  <ProgressRing value={60} size={36} stroke={3} color={ACCENT_TOOLS} label="…" />
                  <div className="min-w-0 flex-1"><p className="truncate font-mono text-xs text-[#F5F5F5]">{runningActionId.replace("tools.", "")}</p><p className="font-mono text-[10px] text-[#525252]">running…</p></div>
                  <StatusChip tone="running" />
                </div>
              )}
              {toolsState.outputs.length === 0 && !runningActionId ? (
                <p className="text-xs text-[#525252]">No outputs yet. Run a tool to see results here.</p>
              ) : (
                <LimitedList items={toolsState.outputs} step={20}>
                  {(output) => (
                    <div key={output.id} className="glass-card flex items-center gap-2 p-2.5">
                      <ProgressRing value={100} size={36} stroke={3} color="#22C55E" label="✓" />
                      <div className="min-w-0 flex-1"><p className="truncate font-mono text-xs text-[#F5F5F5]">{output.operation} · {output.fileName}</p><p className="font-mono text-[10px] text-[#525252]">{formatBytes(output.byteLength)} · {formatDate(output.createdAt)}</p></div>
                      <button type="button" onClick={() => void getBridge().openToolsFile(output.path)} title="Open the output file" className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#262626] px-2 py-1 text-[10px] text-[#A3A3A3] hover:border-[#F97316]/40 hover:text-[#F97316]"><FolderOpen className="h-3 w-3" />Open</button>
                      <button type="button" title="Remove from the list (keeps the file on disk)" onClick={() => void (async () => { const r = await onAction("tools.delete_output", "module_ui", { id: output.id }) as { ok?: boolean }; if (r.ok) { await onRefresh(); } })()} className="inline-flex shrink-0 items-center rounded-md border border-[#262626] px-2 py-1 text-[10px] text-[#A3A3A3] hover:text-[#F5F5F5]">Remove</button>
                      <button type="button" title="Delete the output file from disk" onClick={() => void (async () => { if (!window.confirm(`Delete ${output.fileName} from disk? This cannot be undone.`)) { return; } const r = await onAction("tools.delete_output_file", "module_ui", { id: output.id, confirmedDangerous: true }) as { ok?: boolean }; if (r.ok) { await onRefresh(); } })()} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-[#262626] px-2 py-1 text-[10px] text-[#A3A3A3] hover:border-[#EF4444]/40 hover:text-[#EF4444]"><Trash2 className="h-3 w-3" />Delete</button>
                    </div>
                  )}
                </LimitedList>
              )}
            </div>
          </GlassCard>

          <div className="grid grid-cols-3 gap-2">
            <ActionButton accent={ACCENT_TOOLS} variant="ghost" icon={FolderOpen} className="justify-center text-xs" onClick={() => void onAction("tools.open_output_folder")}>Output</ActionButton>
            <button type="button" disabled={!latestOutput} onClick={() => latestOutput && void saveOutputToVault(latestOutput)} className="tools-action-button tools-action-button--vault"><Vault className="h-4 w-4" />To Vault</button>
            <button type="button" disabled={!latestOutput} onClick={() => latestOutput && void sendOutputToDrop(latestOutput)} className="tools-action-button tools-action-button--drop"><Share2 className="h-4 w-4" />To Drop</button>
          </div>

          {ocrPreview && (
            <GlassCard hover={false}>
              <SectionTitle action={ocrMetadata ? <span className="font-mono text-[10px] text-[#525252]">{ocrMetadata.engine}{ocrMetadata.averageConfidence != null ? ` · ${Math.round(ocrMetadata.averageConfidence * 100)}%` : ""}</span> : undefined}>OCR preview</SectionTitle>
              <pre className="max-h-40 overflow-auto rounded-lg border border-[#1f1f1f] bg-[#0a0a0a] p-3 font-mono text-xs text-[#F5F5F5] whitespace-pre-wrap">{ocrPreview}</pre>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}
