import React, { useState } from 'react';
import { Loader2, FileJson, CheckCircle2, AlertCircle } from 'lucide-react';

interface ArticleSummary {
  title: string;
  subtopics: string[];
  summary: string;
  hashtags: string[];
  content: string;
}

export default function ArticleSummarizer() {
  const [articleText, setArticleText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<ArticleSummary | null>(null);
  const [savedPath, setSavedPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [isPublishing, setIsPublishing] = useState(false);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);

  const [isGeneratingSuno, setIsGeneratingSuno] = useState(false);
  const [sunoStatus, setSunoStatus] = useState<string | null>(null);

  // 컴포넌트 마운트 시 IPC 이벤트 리스너 등록
  React.useEffect(() => {
    (window as any).electron.onPublishStatus((status: string) => {
      setPublishStatus(status);
    });
    
    (window as any).electron.onSunoStatus((status: string) => {
      setSunoStatus(status);
    });
    
    return () => {
      (window as any).electron.removePublishStatusListener();
      (window as any).electron.removeSunoStatusListener();
    };
  }, []);

  const handleProcess = async () => {
    if (!articleText.trim()) {
      setError('기사 내용을 입력해주세요.');
      return;
    }

    setIsProcessing(true);
    setError(null);
    setResult(null);
    setSavedPath(null);
    setPublishStatus(null);

    try {
      const response = await (window as any).electron.processArticle(articleText);
      if (response.success) {
        setResult(response.data);
        setSavedPath(response.savedPath);
      } else {
        setError(response.error || '변환 중 오류가 발생했습니다.');
      }
    } catch (err: any) {
      setError(err.message || '알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePublish = async () => {
    if (!result) return;
    
    setIsPublishing(true);
    setError(null);
    setPublishStatus('초기화 중...');

    try {
      const response = await (window as any).electron.publishArticle(result);
      if (response.success) {
        setPublishStatus(response.message);
      } else {
        setError(response.error || '등록 중 오류가 발생했습니다.');
        setPublishStatus(null);
      }
    } catch (err: any) {
      setError(err.message || '알 수 없는 오류가 발생했습니다.');
      setPublishStatus(null);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleGenerateSuno = async () => {
    if (!result) return;
    
    setIsGeneratingSuno(true);
    setError(null);
    setSunoStatus('초기화 중...');

    try {
      const response = await (window as any).electron.generateSunoSong(result);
      if (response.success) {
        setSunoStatus(`성공: ${response.message}`);
      } else {
        setError(response.error || 'Suno AI 생성 중 오류가 발생했습니다.');
        setSunoStatus(null);
      }
    } catch (err: any) {
      setError(err.message || '알 수 없는 오류가 발생했습니다.');
      setSunoStatus(null);
    } finally {
      setIsGeneratingSuno(false);
    }
  };

  return (
    <div className="h-full flex flex-col p-6 bg-slate-900/50 overflow-y-auto">
      <div className="max-w-4xl w-full mx-auto space-y-6">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">기사 요약 및 JSON 변환</h1>
          <p className="text-slate-400">신문 기사를 붙여넣으면 AI가 분석하여 JSON 파일로 자동 저장합니다.</p>
        </header>

        <div className="space-y-4">
          <label className="text-sm font-semibold text-slate-300 uppercase tracking-widest">기사 원문</label>
          <textarea
            value={articleText}
            onChange={(e) => setArticleText(e.target.value)}
            placeholder="여기에 기사 내용을 붙여넣으세요..."
            className="w-full h-64 bg-black/40 border border-white/10 rounded-xl p-4 text-sm focus:border-primary outline-none transition-all text-white resize-none"
            disabled={isProcessing || isPublishing}
          />
        </div>

        <button
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
              <span>AI 분석 및 저장 중...</span>
            </>
          ) : (
            <>
              <FileJson className="w-5 h-5" />
              <span>JSON 변환 및 자동 저장</span>
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
                분석 결과
              </h2>
              {savedPath && (
                <span className="text-xs text-emerald-400/80 bg-emerald-400/10 px-3 py-1 rounded-full border border-emerald-400/20">
                  저장됨: {savedPath}
                </span>
              )}
            </div>
            
            <div className="bg-black/60 border border-white/10 rounded-xl p-6 font-mono text-sm overflow-x-auto text-emerald-300">
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </div>

            <div className="pt-4 border-t border-white/10 space-y-3">
              <button
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
                    <span>{publishStatus || '자동 등록 진행 중...'}</span>
                  </>
                ) : (
                  <>
                    <span>어드민에 기사 등록하기 (자동화 봇 실행)</span>
                  </>
                )}
              </button>
              {publishStatus && !isPublishing && !error && (
                <p className="mt-2 text-sm text-center text-emerald-400">{publishStatus}</p>
              )}

              <button
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
                    <span>{sunoStatus || 'Suno AI 생성 진행 중...'}</span>
                  </>
                ) : (
                  <>
                    <span>Suno AI 노래 생성하기</span>
                  </>
                )}
              </button>
              {sunoStatus && !isGeneratingSuno && !error && (
                <p className="mt-2 text-sm text-center text-purple-400">{sunoStatus}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
