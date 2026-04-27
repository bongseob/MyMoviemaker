import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertCircle, FileText, Upload, Check } from 'lucide-react';

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
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successPath, setSuccessPath] = useState<string | null>(null);

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
    setStatus('Preparing subtitle refinement...');

    try {
      const response = await electron.refineSubtitles({
        srtPath,
        summaryText
      });

      if (response.success) {
        setSuccessPath(response.outputPath || null);
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
          </div>

          <div className="space-y-6">
            <div className="space-y-4">
              <label className="text-sm font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <Upload className="w-4 h-4 text-teal-400" />
                SRT File to Refine
              </label>

              <button
                type="button"
                onClick={handleSelectSrt}
                disabled={isProcessing}
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
              disabled={isProcessing || !srtPath || !summaryText.trim()}
              className={`w-full py-5 rounded-2xl font-bold text-lg transition-all flex items-center justify-center gap-3 shadow-xl ${
                isProcessing || !srtPath || !summaryText.trim()
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
                <p className="text-xs text-slate-400">
                  The refined SRT was saved next to the original file with _refined added to the name.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
