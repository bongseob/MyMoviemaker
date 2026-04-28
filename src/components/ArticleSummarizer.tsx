import { useEffect, useState } from 'react';
import { Loader2, FileJson, CheckCircle2, AlertCircle, Copy } from 'lucide-react';

export interface ArticleSummary {
  title: string;
  subtopics: string[];
  summary: string;
  hashtags: string[];
  content: string;
  copyText?: string;
  revisionNotes?: string[];
}

interface ArticleSummarizerProps {
  onResultChange?: (result: ArticleSummary | null) => void;
  initialResult?: ArticleSummary | null;
}

const getErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : 'Unknown error occurred.';
};

const electronUnavailableMessage =
  'Electron API is not available. Run `npm run electron:dev` and use the desktop app window, not the browser tab.';

const buildCopyText = (result: ArticleSummary) => {
  if (result.copyText?.trim()) return result.copyText;

  return [
    result.title,
    '',
    ...(result.subtopics || []).map((item) => `- ${item}`),
    '',
    (result.hashtags || []).join(' ')
  ].join('\n').trim();
};

export default function ArticleSummarizer({ onResultChange, initialResult }: ArticleSummarizerProps) {
  const [articleText, setArticleText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ArticleSummary | null>(initialResult || null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);

  const [isGeneratingSuno, setIsGeneratingSuno] = useState(false);
  const [sunoStatus, setSunoStatus] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  useEffect(() => {
    const electron = window.electron;
    if (!electron) {
      setError(electronUnavailableMessage);
      return;
    }

    electron.onPublishStatus((status: string) => {
      setPublishStatus(status);
    });

    electron.onSunoStatus((status: string) => {
      setSunoStatus(status);
    });

    return () => {
      electron.removePublishStatusListener();
      electron.removeSunoStatusListener();
    };
  }, []);

  const handleProcess = async () => {
    const electron = window.electron;
    if (!electron) {
      setError(electronUnavailableMessage);
      return;
    }

    if (!articleText.trim()) {
      setError('Please enter article text.');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);
    setSavedPath(null);
    setPublishStatus(null);
    setCopyStatus(null);

    try {
      const response = await electron.processArticle(articleText);
      if (response.success && response.data) {
        setResult(response.data);
        onResultChange?.(response.data);
        setSavedPath(response.savedPath || null);
      } else {
        setError(response.error || 'Failed to convert article.');
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePublish = async () => {
    const electron = window.electron;
    if (!electron || !result) return;

    setIsPublishing(true);
    setError(null);
    setPublishStatus('Preparing...');

    try {
      const response = await electron.publishArticle(result);
      if (response.success) {
        setPublishStatus(response.message || 'Article was published.');
      } else {
        setError(response.error || 'Failed to publish article.');
        setPublishStatus(null);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      setPublishStatus(null);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleGenerateSuno = async () => {
    const electron = window.electron;
    if (!electron || !result) return;

    setIsGeneratingSuno(true);
    setError(null);
    setSunoStatus('Preparing...');

    try {
      const response = await electron.generateSunoSong(result);
      if (response.success) {
        const outputPath = response.outputPath ? `\n저장 위치: ${response.outputPath}` : '';
        setSunoStatus(`${response.message || 'Song generation completed.'}${outputPath}`);
      } else {
        setError(response.error || 'Failed to generate Suno song.');
        setSunoStatus(null);
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err));
      setSunoStatus(null);
    } finally {
      setIsGeneratingSuno(false);
    }
  };

  const handleCopyText = async () => {
    if (!result) return;

    try {
      await navigator.clipboard.writeText(buildCopyText(result));
      setCopyStatus('복사되었습니다.');
    } catch (err: unknown) {
      setCopyStatus(getErrorMessage(err));
    }
  };

  return (
    <div className="h-full flex flex-col p-6 bg-slate-900/50 overflow-y-auto">
      <div className="max-w-4xl w-full mx-auto space-y-6">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">&#44592;&#49324; &#50836;&#50557; &#48143; JSON &#48320;&#54872;</h1>
          <p className="text-slate-400">
            &#49888;&#47928; &#44592;&#49324;&#47484; &#48537;&#50668;&#45347;&#51004;&#47732; AI&#44032; &#48516;&#49437;&#54616;&#50668; JSON &#54028;&#51068;&#47196; &#51088;&#46041; &#51200;&#51109;&#54633;&#45768;&#45796;.
          </p>
        </header>

        <div className="space-y-4">
          <label className="text-sm font-semibold text-slate-300 uppercase tracking-widest">&#44592;&#49324; &#50896;&#47928;</label>
          <textarea
            value={articleText}
            onChange={(e) => setArticleText(e.target.value)}
            placeholder="&#50668;&#44592;&#50640; &#44592;&#49324; &#45236;&#50857;&#51012; &#48537;&#50668;&#45347;&#51004;&#49464;&#50836;..."
            className="w-full h-64 bg-black/40 border border-white/10 rounded-xl p-4 text-sm focus:border-primary outline-none transition-all text-white resize-none"
            disabled={isProcessing || isPublishing}
          />
        </div>

        <button
          type="button"
          onClick={handleProcess}
          disabled={isProcessing || isPublishing || !articleText.trim()}
          className={`w-full py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
            isProcessing || isPublishing || !articleText.trim()
              ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
              : 'bg-primary hover:bg-primary/80 text-white'
          }`}
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              <span>AI &#48516;&#49437; &#48143; &#51200;&#51109; &#51473;...</span>
            </>
          ) : (
            <>
              <FileJson className="w-5 h-5" />
              <span>JSON &#48320;&#54872; &#48143; &#51088;&#46041; &#51200;&#51109;</span>
            </>
          )}
        </button>

        {error && (
          <div className="p-4 bg-red-500/20 border border-red-500/50 rounded-xl flex items-start gap-3 text-red-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="text-sm whitespace-pre-wrap">{error}</div>
          </div>
        )}

        {result && (
          <div className="mt-8 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                &#48516;&#49437; &#44208;&#44284;
              </h2>
              {savedPath && (
                <span className="text-xs text-emerald-400/80 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-400/20">
                  &#51200;&#51109;&#46120;: {savedPath}
                </span>
              )}
            </div>

            <div className="bg-black/50 border border-white/10 rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">복사용 텍스트</h3>
                <button
                  type="button"
                  onClick={handleCopyText}
                  className="px-3 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-xs font-bold text-slate-200 transition-colors flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  복사
                </button>
              </div>
              <textarea
                readOnly
                value={buildCopyText(result)}
                className="w-full h-40 bg-black/40 border border-white/10 rounded-lg p-4 text-sm text-slate-100 font-mono resize-none outline-none"
              />
              {copyStatus && (
                <p className="text-xs text-emerald-400">{copyStatus}</p>
              )}
            </div>

            {Array.isArray(result.revisionNotes) && result.revisionNotes.length > 0 && (
              <div className="bg-black/50 border border-white/10 rounded-xl p-5 space-y-3">
                <h3 className="text-sm font-bold text-white uppercase tracking-widest">기사 수정 내역</h3>
                <ul className="space-y-2 text-sm text-slate-300">
                  {result.revisionNotes.map((note, index) => (
                    <li key={`${note}-${index}`} className="flex gap-2">
                      <span className="text-primary">-</span>
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="bg-black/60 border border-white/10 rounded-xl p-6 font-mono text-sm overflow-x-auto text-emerald-300">
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </div>

            <div className="pt-4 border-t border-white/10 space-y-3">
              <button
                type="button"
                onClick={handlePublish}
                disabled={isPublishing || isGeneratingSuno}
                className={`w-full py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
                  isPublishing || isGeneratingSuno
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                }`}
              >
                {isPublishing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{publishStatus || 'Publishing...'}</span>
                  </>
                ) : (
                  <span>&#50612;&#46300;&#48124;&#50640; &#44592;&#49324; &#46321;&#47197;&#54616;&#44592;</span>
                )}
              </button>
              {publishStatus && !isPublishing && !error && (
                <p className="mt-2 text-sm text-center text-emerald-400">{publishStatus}</p>
              )}

              <button
                type="button"
                onClick={handleGenerateSuno}
                disabled={isPublishing || isGeneratingSuno}
                className={`w-full py-4 rounded-xl font-bold transition-all flex items-center justify-center gap-2 ${
                  isPublishing || isGeneratingSuno
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed'
                    : 'bg-purple-600 hover:bg-purple-500 text-white'
                }`}
              >
                {isGeneratingSuno ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>{sunoStatus || 'Generating Suno song...'}</span>
                  </>
                ) : (
                  <span>Suno AI &#45432;&#47000; &#49373;&#49457;&#54616;&#44592;</span>
                )}
              </button>
              {sunoStatus && !isGeneratingSuno && !error && (
                <p className="mt-2 text-sm text-center text-purple-400 whitespace-pre-wrap break-all">{sunoStatus}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
