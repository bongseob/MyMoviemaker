import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, FileText, Upload, Check, Captions, Save } from 'lucide-react';

interface SubtitleRefinerProps {
  initialSummary?: string;
}

const getErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : 'Unknown error occurred.';
};

const electronUnavailableMessage =
  'Electron API is not available. Run `npm run electron:dev` and use the desktop app window, not the browser tab.';

export default function SubtitleRefiner({ initialSummary }: SubtitleRefinerProps) {
  const [srtPath, setSrtPath] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState(initialSummary || '');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isGeneratingSrt, setIsGeneratingSrt] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successPath, setSuccessPath] = useState<string | null>(null);
  const [sourceAudioPath, setSourceAudioPath] = useState<string | null>(null);
  const [refinedContent, setRefinedContent] = useState('');
  const [isSavingContent, setIsSavingContent] = useState(false);

  useEffect(() => {
    if (initialSummary && !summaryText) {
      setSummaryText(initialSummary);
    }
  }, [initialSummary, summaryText]);

  useEffect(() => {
    const electron = window.electron;
    if (!electron) {
      setError(electronUnavailableMessage);
      return;
    }

    electron.onRefineStatus((msg: string) => {
      setStatus(msg);
    });

    return () => {
      electron.removeRefineStatusListener();
    };
  }, []);

  const handleSelectSrt = async () => {
    const electron = window.electron;
    if (!electron) {
      setError(electronUnavailableMessage);
      return;
    }

    setError(null);

    try {
      const result = await electron.selectSrtFile();

      if (!result.canceled && result.filePaths.length > 0) {
        setSrtPath(result.filePaths[0]);
        setSuccessPath(null);
        setRefinedContent('');
        setStatus(null);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    }
  };

  const handleRefine = async () => {
    const electron = window.electron;
    if (!electron) {
      setError(electronUnavailableMessage);
      return;
    }

    if (!srtPath || !summaryText.trim()) return;

    setIsProcessing(true);
    setError(null);
    setSuccessPath(null);
    setRefinedContent('');
    setStatus('Preparing subtitle refinement...');

    try {
      const response = await electron.refineSubtitles({
        srtPath,
        summaryText
      });

      if (response.success) {
        const data = response.data as { content?: string } | undefined;
        setSuccessPath(response.outputPath || null);
        setRefinedContent(data?.content || '');
        setStatus('Subtitle refinement completed.');
      } else {
        setError(response.error || 'Failed to refine subtitles.');
        setStatus(null);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      setStatus(null);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGenerateSrtFromSuno = async () => {
    const electron = window.electron;
    if (!electron) {
      setError(electronUnavailableMessage);
      return;
    }

    setIsGeneratingSrt(true);
    setError(null);
    setSuccessPath(null);
    setSourceAudioPath(null);
    setRefinedContent('');
    setStatus('Preparing SRT generation from the latest Suno MP3...');

    try {
      const response = await electron.generateSrtFromSuno();

      if (response.success && response.outputPath) {
        setSrtPath(response.outputPath);
        setSuccessPath(response.outputPath);
        setSourceAudioPath(response.sourcePath || null);
        setRefinedContent('');
        setStatus('SRT generation completed.');
      } else {
        setError(response.error || 'Failed to generate SRT from Suno MP3.');
        setStatus(null);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      setStatus(null);
    } finally {
      setIsGeneratingSrt(false);
    }
  };

  const handleSaveRefinedContent = async () => {
    const electron = window.electron;
    const targetPath = successPath || srtPath;

    if (!electron) {
      setError(electronUnavailableMessage);
      return;
    }

    if (!targetPath || !refinedContent.trim()) return;

    setIsSavingContent(true);
    setError(null);
    setStatus('Saving manual subtitle edits...');

    try {
      const response = await electron.saveSrtContent({
        srtPath: targetPath,
        content: refinedContent
      });

      if (response.success) {
        setSuccessPath(response.outputPath || targetPath);
        setStatus('Manual subtitle edits saved.');
      } else {
        setError(response.error || 'Failed to save subtitle edits.');
        setStatus(null);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      setStatus(null);
    } finally {
      setIsSavingContent(false);
    }
  };

  return (
    <div className="h-full flex flex-col p-6 bg-slate-900/50 overflow-y-auto">
      <div className="max-w-4xl w-full mx-auto space-y-8">
        <header className="mb-4">
          <h1 className="text-3xl font-bold text-white mb-2">AI Subtitle Refiner (SRT)</h1>
          <p className="text-slate-400">
            Use the article summary as a reference to correct transcription errors and spacing in an SRT file.
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                Reference Summary
              </label>
              {initialSummary && (
                <button
                  type="button"
                  onClick={() => setSummaryText(initialSummary)}
                  className="text-[10px] text-primary hover:underline"
                >
                  Reload Article Summary
                </button>
              )}
            </div>
            <textarea
              value={summaryText}
              onChange={(e) => setSummaryText(e.target.value)}
              placeholder="Enter the article summary to use as the subtitle correction reference."
              className="w-full h-80 bg-black/40 border border-white/10 rounded-2xl p-5 text-sm focus:border-primary outline-none transition-all text-white resize-none leading-relaxed"
              disabled={isProcessing}
            />

            {refinedContent && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                    <FileText className="w-4 h-4 text-emerald-400" />
                    Final SRT Review
                  </label>
                  <button
                    type="button"
                    onClick={handleSaveRefinedContent}
                    disabled={isSavingContent || isProcessing || isGeneratingSrt || !refinedContent.trim()}
                    className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 text-xs font-bold text-white transition-colors flex items-center gap-2"
                  >
                    {isSavingContent ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    저장
                  </button>
                </div>
                <textarea
                  value={refinedContent}
                  onChange={(e) => setRefinedContent(e.target.value)}
                  placeholder="교정된 SRT 내용이 여기에 표시됩니다."
                  className="w-full h-96 bg-black/40 border border-emerald-500/30 rounded-2xl p-5 text-sm focus:border-emerald-400 outline-none transition-all text-white resize-y leading-relaxed font-mono"
                  disabled={isSavingContent}
                />
                <p className="text-xs text-slate-400">
                  교정 결과를 최종 확인한 뒤 직접 수정하고 저장할 수 있습니다.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="space-y-4">
              <label className="text-sm font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <Upload className="w-4 h-4 text-teal-400" />
                SRT File to Refine
              </label>

              <button
                type="button"
                onClick={handleGenerateSrtFromSuno}
                disabled={isProcessing || isGeneratingSrt}
                className={`w-full py-5 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-3 shadow-xl ${
                  isProcessing || isGeneratingSrt
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed shadow-none'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-indigo-500/20'
                }`}
              >
                {isGeneratingSrt ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>{status || 'Generating SRT...'}</span>
                  </>
                ) : (
                  <>
                    <Captions className="w-6 h-6" />
                    <span>Suno MP3로 SRT 생성</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleSelectSrt}
                disabled={isProcessing || isGeneratingSrt}
                className={`w-full group relative overflow-hidden transition-all duration-300 ${
                  srtPath
                    ? 'bg-teal-500/10 border-teal-500/50'
                    : 'bg-black/40 border-dashed border-2 border-white/10 hover:border-teal-500/50 hover:bg-teal-500/5'
                } border rounded-2xl p-10 flex flex-col items-center gap-4 disabled:cursor-not-allowed disabled:opacity-60`}
              >
                <div className={`w-16 h-16 rounded-full flex items-center justify-center transition-transform group-hover:scale-110 ${
                  srtPath ? 'bg-teal-500/20' : 'bg-white/5'
                }`}>
                  {srtPath ? <Check className="w-8 h-8 text-teal-400" /> : <Upload className="w-8 h-8 text-slate-400" />}
                </div>
                <div className="text-center">
                  <p className="font-semibold text-white">
                    {srtPath ? srtPath.split(/[\\/]/).pop() : 'Select SRT File'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {srtPath ? 'Click to choose a different file.' : 'SubRip Subtitle file (*.srt)'}
                  </p>
                </div>
              </button>
            </div>

            <button
              type="button"
              onClick={handleRefine}
              disabled={isProcessing || isGeneratingSrt || !srtPath || !summaryText.trim()}
              className={`w-full py-5 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-3 shadow-xl ${
                isProcessing || isGeneratingSrt || !srtPath || !summaryText.trim()
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed shadow-none'
                  : 'bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 text-white hover:shadow-teal-500/20'
              }`}
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span>{status || 'Refining subtitles...'}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-6 h-6" />
                  <span>Start AI Subtitle Refinement</span>
                </>
              )}
            </button>

            {error && (
              <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-2xl flex items-start gap-3 text-red-400 animate-in fade-in zoom-in duration-300">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div className="text-sm font-medium">{error}</div>
              </div>
            )}

            {successPath && (
              <div className="p-6 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl space-y-3 animate-in fade-in zoom-in duration-500">
                <div className="flex items-center gap-3 text-emerald-400">
                  <CheckCircle2 className="w-6 h-6" />
                  <span className="font-bold text-lg">Subtitle refinement completed.</span>
                </div>
                <div className="text-sm text-slate-300 bg-black/30 p-3 rounded-lg break-all font-mono">
                  {successPath}
                </div>
                {sourceAudioPath && (
                  <div className="text-xs text-slate-400 bg-black/20 p-3 rounded-lg break-all font-mono">
                    Source MP3: {sourceAudioPath}
                  </div>
                )}
                <p className="text-xs text-slate-400">
                  Generated SRT files use yyyymmdd.srt, with _1, _2 added when the file already exists.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
