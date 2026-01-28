import { useState, useEffect, useCallback } from 'react';
import {
  Plus,
  Settings,
  Play,
  Download,
  Image as ImageIcon,
  Music,
  Trash2,
  Clock,
  Layers,
  Loader2,
  CheckCircle2,
  UploadCloud,
  X,
  Minus
} from 'lucide-react';

interface Project {
  aspectRatio: '16:9' | '9:16';
  name: string;
}

interface Slide {
  id: string;
  url: string;
  path: string;
  duration: number;
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'images' | 'audio' | 'subtitles'>('images');
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [titleText, setTitleText] = useState('');
  const [titlePosition, setTitlePosition] = useState<'top' | 'center' | 'bottom'>('center');
  const [targetDuration, setTargetDuration] = useState(3);
  const [subtitlePath, setSubtitlePath] = useState<string | null>(null);

  useEffect(() => {
    if ((window as any).electron) {
      (window as any).electron.onProgress((percent: number) => {
        setExportProgress(Math.round(percent || 0));
      });
    }
  }, []);

  // Global Drag and Drop Handlers
  const handleGlobalDrag = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragover' || e.type === 'dragenter') {
      setIsDragging(true);
    } else if (e.type === 'dragleave') {
      // Small delay to prevent flickering
      if (e.relatedTarget === null) {
        setIsDragging(false);
      }
    }
  }, []);

  const handleGlobalDrop = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (!project) return;

    const files = Array.from(e.dataTransfer?.files || []);
    console.log('Files dropped:', files.length);

    const { electron } = window as any;
    if (!electron) return;

    // Use webUtils.getPathForFile exposed via preload
    const filePaths: string[] = files.map((f: any) => {
      try {
        return electron.getPathForFile(f) || f.path || '';
      } catch (err) {
        console.error('Error getting path:', err);
        return f.path || '';
      }
    }).filter(p => !!p);

    console.log('Processed paths:', filePaths);

    const imagePaths = filePaths.filter(p => /\.(jpg|jpeg|png|webp|gif)$/i.test(p));
    const audioPaths = filePaths.filter(p => /\.(mp3|wav|m4a|ogg)$/i.test(p));

    if (imagePaths.length > 0) {
      const newSlides = imagePaths.map((path: string, index: number) => ({
        id: `${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
        url: path,
        path: path,
        duration: 3
      }));
      setSlides(prev => [...prev, ...newSlides]);
      setActiveTab('images');
    }

    if (audioPaths.length > 0) {
      setAudioPath(audioPaths[0]);
      setActiveTab('audio');
    }
  }, [project]);

  useEffect(() => {
    window.addEventListener('dragover', handleGlobalDrag);
    window.addEventListener('dragenter', handleGlobalDrag);
    window.addEventListener('dragleave', handleGlobalDrag);
    window.addEventListener('drop', handleGlobalDrop);
    return () => {
      window.removeEventListener('dragover', handleGlobalDrag);
      window.removeEventListener('dragenter', handleGlobalDrag);
      window.removeEventListener('dragleave', handleGlobalDrag);
      window.removeEventListener('drop', handleGlobalDrop);
    };
  }, [handleGlobalDrag, handleGlobalDrop]);

  const handleExport = async () => {
    if (slides.length === 0) {
      alert('Please add at least one image.');
      return;
    }

    const { electron } = window as any;
    if (!electron) return;

    const result = await electron.selectSavePath({
      title: 'Save Video',
      defaultPath: 'output.mp4',
      buttonLabel: 'Export',
      properties: ['createDirectory', 'showOverwriteConfirmation'],
      filters: [{ name: 'Video', extensions: ['mp4'] }]
    });

    if (result.canceled || !result.filePath) return;

    setIsExporting(true);
    setExportProgress(0);
    setExportSuccess(false);

    try {
      await electron.exportVideo({
        slides,
        audioPath,
        outputPath: result.filePath,
        aspectRatio: project?.aspectRatio,
        titleText: titleText,
        titlePosition: titlePosition,
        targetDuration: targetDuration,
        subtitlePath: subtitlePath
      });
      setExportSuccess(true);
    } catch (err) {
      console.error('Export failed:', err);
      alert('Export failed. Make sure FFmpeg is installed.');
    } finally {
      setIsExporting(false);
    }
  };

  const createProject = (ratio: '16:9' | '9:16') => {
    setProject({ name: 'New Project', aspectRatio: ratio });
  };

  const handleAddImages = async (index?: number) => {
    if (!(window as any).electron) return;
    const result = await (window as any).electron.selectFiles({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'png', 'jpeg', 'webp'] }]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const newSlides = result.filePaths.map((path: string, idx: number) => ({
        id: `${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`,
        url: path,
        path: path,
        duration: 3
      }));

      if (typeof index === 'number') {
        const updatedSlides = [...slides];
        updatedSlides.splice(index + 1, 0, ...newSlides);
        setSlides(updatedSlides);
      } else {
        setSlides([...slides, ...newSlides]);
      }
    }
  };

  const handleAddAudio = async () => {
    if (!(window as any).electron) return;
    const result = await (window as any).electron.selectFiles({
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a'] }]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      setAudioPath(result.filePaths[0]);
    }
  };

  const handleAddSubtitles = async () => {
    if (!(window as any).electron) return;
    const result = await (window as any).electron.selectFiles({
      properties: ['openFile'],
      filters: [{ name: 'Subtitles', extensions: ['srt'] }]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      setSubtitlePath(result.filePaths[0]);
    }
  };

  const removeSlide = (id: string) => {
    setSlides(slides.filter(s => s.id !== id));
  };

  const clearSlides = () => {
    if (slides.length === 0) return;
    if (confirm('모든 슬라이드를 삭제하시겠습니까?')) {
      setSlides([]);
    }
  };

  if (!project) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-background text-white p-8">
        <div className="max-w-4xl w-full">
          <header className="mb-12 text-center">
            <h1 className="text-5xl font-bold mb-4 bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent italic">
              ANTIGRAVITY MOVIE MAKER
            </h1>
            <p className="text-slate-400 text-lg">AI-powered simple video generator</p>
          </header>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <button
              onClick={() => createProject('16:9')}
              className="glass-card p-12 flex flex-col items-center hover:scale-105 transition-all group"
            >
              <div className="aspect-video w-48 bg-slate-800 rounded-lg mb-6 border-2 border-primary/50 group-hover:border-primary transition-colors flex items-center justify-center">
                <ImageIcon className="w-12 h-12 text-primary" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">Horizontal (16:9)</h2>
              <p className="text-slate-400">Perfect for YouTube, Desktop</p>
            </button>

            <button
              onClick={() => createProject('9:16')}
              className="glass-card p-12 flex flex-col items-center hover:scale-105 transition-all group"
            >
              <div className="aspect-[9/16] h-48 bg-slate-800 rounded-lg mb-6 border-2 border-secondary/50 group-hover:border-secondary transition-colors flex items-center justify-center">
                <ImageIcon className="w-12 h-12 text-secondary" />
              </div>
              <h2 className="text-2xl font-semibold mb-2">Vertical (9:16)</h2>
              <p className="text-slate-400">Optimized for Reels, Shorts, TikTok</p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background text-slate-200 overflow-hidden relative">
      {/* Global Drag Overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-primary/20 backdrop-blur-md border-4 border-dashed border-primary m-4 rounded-3xl flex flex-col items-center justify-center animate-in fade-in duration-300 pointer-events-none">
          <UploadCloud className="w-24 h-24 text-primary animate-bounce mb-4" />
          <h2 className="text-3xl font-bold text-white uppercase tracking-tighter">Drop files to add</h2>
          <p className="text-primary-foreground/70 font-medium">Images & Audio supported</p>
        </div>
      )}

      <header className="h-12 border-b border-white/10 flex items-center justify-between px-6 drag-region">
        <div className="flex items-center gap-3">
          <Layers className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm uppercase tracking-wider">{project.name} - {project.aspectRatio}</span>
        </div>
        <div className="flex items-center gap-2 no-drag">
          <button className="text-slate-400 hover:text-white transition-colors p-1">
            <Settings className="w-5 h-5" />
          </button>
          <div className="h-4 w-[1px] bg-white/10 mx-1" />
          <button
            onClick={() => (window as any).electron.minimize()}
            className="text-slate-400 hover:text-white hover:bg-white/5 p-1 rounded transition-all"
            title="Minimize"
          >
            <Minus className="w-5 h-5" />
          </button>
          <button
            onClick={() => (window as any).electron.close()}
            className="text-slate-400 hover:text-red-400 hover:bg-red-500/10 p-1 rounded transition-all"
            title="Close"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="w-2" />
          <button
            onClick={handleExport}
            disabled={isExporting}
            className={`${isExporting ? 'bg-slate-700' : 'bg-primary hover:bg-primary/80'} text-white px-4 py-1 rounded-full text-xs font-bold transition-all flex items-center gap-2 ml-2`}
          >
            {isExporting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
            {isExporting ? `EXPORTING ${exportProgress}%` : 'EXPORT'}
          </button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        <aside className="w-80 border-r border-white/10 flex flex-col">
          <div className="flex border-b border-white/10">
            <button
              onClick={() => setActiveTab('images')}
              className={`flex-1 p-4 transition-colors flex justify-center ${activeTab === 'images' ? 'border-b-2 border-primary bg-primary/10' : 'hover:bg-white/5'}`}
            >
              <ImageIcon className="w-5 h-5 text-primary" />
            </button>
            <button
              onClick={() => setActiveTab('audio')}
              className={`flex-1 p-4 transition-colors flex justify-center ${activeTab === 'audio' ? 'border-b-2 border-secondary bg-secondary/10' : 'hover:bg-white/5'}`}
            >
              <Music className="w-5 h-5 text-secondary" />
            </button>
            <button
              onClick={() => setActiveTab('subtitles')}
              className={`flex-1 p-4 transition-colors flex justify-center ${activeTab === 'subtitles' ? 'border-b-2 border-teal-500 bg-teal-500/10' : 'hover:bg-white/5'}`}
            >
              <Settings className="w-5 h-5 text-teal-400" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {activeTab === 'images' && (
              <>
                <button
                  onClick={() => handleAddImages()}
                  className="w-full glass-card p-6 border-dashed border-2 border-white/10 flex flex-col items-center gap-3 hover:bg-white/10 transition-colors"
                >
                  <div className="w-10 h-10 bg-primary/20 rounded-full flex items-center justify-center">
                    <Plus className="w-6 h-6 text-primary" />
                  </div>
                  <span className="text-sm font-medium">Add Images</span>
                </button>

                <div className="space-y-3">
                  <p className="text-xs text-slate-500 uppercase tracking-widest mt-6 mb-2">Library ({slides.length})</p>
                  {slides.length === 0 ? (
                    <div className="text-center py-12 text-slate-500 italic text-sm">
                      Empty library. Start by adding images.
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {slides.map(slide => (
                        <div key={slide.id} className="group relative aspect-video bg-black rounded-lg overflow-hidden border border-white/10">
                          <img src={slide.url} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity" alt="" />
                          <button
                            onClick={() => removeSlide(slide.id)}
                            className="absolute top-1 right-1 p-1 bg-black/60 rounded-md opacity-0 group-hover:opacity-100 transition-opacity text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                          <div className="absolute bottom-1 left-1 px-1 bg-black/60 rounded text-[10px] text-white">
                            {slide.duration}s
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}

            {activeTab === 'audio' && (
              <div className="space-y-4">
                <button
                  onClick={handleAddAudio}
                  className="w-full glass-card p-6 border-dashed border-2 border-white/10 flex flex-col items-center gap-3 hover:bg-white/10 transition-colors"
                >
                  <div className="w-10 h-10 bg-secondary/20 rounded-full flex items-center justify-center">
                    <Music className="w-6 h-6 text-secondary" />
                  </div>
                  <span className="text-sm font-medium">{audioPath ? 'Change Audio' : 'Add Audio (MP3)'}</span>
                </button>

                {audioPath && (
                  <div className="glass-card p-4 flex items-center gap-3">
                    <Music className="w-5 h-5 text-secondary" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{audioPath.split(/[\\/]/).pop()}</p>
                      <p className="text-[10px] text-slate-500">Background Track</p>
                    </div>
                    <button
                      onClick={() => setAudioPath(null)}
                      className="text-slate-500 hover:text-red-400"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'subtitles' && (
              <div className="space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 uppercase tracking-widest">Video Duration (Seconds)</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="1"
                      max="3600"
                      value={targetDuration}
                      onChange={(e) => setTargetDuration(Number(e.target.value))}
                      className="flex-1 bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:border-primary outline-none transition-all text-white"
                    />
                    <span className="text-sm text-slate-400">sec</span>
                  </div>
                  <p className="text-[10px] text-slate-500 italic">
                    {audioPath ? 'Audio length will override this value.' : 'Default: 3 seconds'}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 uppercase tracking-widest">Main Title Overlay</label>
                  <input
                    type="text"
                    value={titleText}
                    onChange={(e) => setTitleText(e.target.value)}
                    placeholder="Enter video title..."
                    className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:border-primary outline-none transition-all text-white"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 uppercase tracking-widest">Position</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(['top', 'center', 'bottom'] as const).map((pos) => (
                      <button
                        key={pos}
                        onClick={() => setTitlePosition(pos)}
                        className={`py-2 text-[10px] font-bold uppercase rounded-md border transition-all ${titlePosition === pos
                          ? 'bg-teal-500/20 border-teal-500 text-teal-400'
                          : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                          }`}
                      >
                        {pos}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] text-slate-500 uppercase tracking-widest">Subtitle File (.srt)</label>
                  <button
                    onClick={handleAddSubtitles}
                    className="w-full glass-card p-4 border-dashed border-2 border-white/10 flex flex-col items-center gap-2 hover:bg-white/10 transition-colors"
                  >
                    <Plus className="w-4 h-4 text-primary" />
                    <span className="text-xs font-medium">{subtitlePath ? 'Change Subtitles' : 'Add SRT File'}</span>
                  </button>
                  {subtitlePath && (
                    <div className="glass-card p-3 flex items-center gap-3 mt-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-medium truncate">{subtitlePath.split(/[\\/]/).pop()}</p>
                      </div>
                      <button
                        onClick={() => setSubtitlePath(null)}
                        className="text-slate-500 hover:text-red-400"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>

        <div className="flex-1 flex flex-col bg-slate-900/50 relative">
          <div className="flex-1 flex items-center justify-center p-8">
            <div className={`shadow-2xl shadow-black/50 bg-black rounded-sm overflow-hidden flex items-center justify-center relative ${project.aspectRatio === '16:9' ? 'aspect-video w-[80%]' : 'aspect-[9/16] h-[70%]'}`}>
              {exportSuccess ? (
                <div className="flex flex-col items-center gap-4 text-emerald-400 animate-in fade-in zoom-in duration-500">
                  <CheckCircle2 className="w-20 h-20" />
                  <h3 className="text-xl font-bold uppercase tracking-widest">Export Complete!</h3>
                  <button
                    onClick={() => setExportSuccess(false)}
                    className="mt-4 px-6 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/50 rounded-full text-sm font-bold transition-all"
                  >
                    GOT IT
                  </button>
                </div>
              ) : (
                <div className="text-slate-600 flex flex-col items-center gap-4 relative w-full h-full">
                  <div className="flex flex-col items-center gap-4">
                    <Play className="w-16 h-16 opacity-20" />
                    <span className="text-sm tracking-widest uppercase opacity-20">Preview Ready</span>
                  </div>
                  {titleText && (
                    <div
                      className={`absolute left-0 right-0 text-center px-4 animate-in fade-in slide-in-from-bottom-2 duration-300 ${titlePosition === 'top' ? 'top-10' :
                        titlePosition === 'center' ? 'top-1/2 -translate-y-1/2' :
                          'bottom-10'
                        }`}
                    >
                      <span className="bg-black/60 text-white px-4 py-2 rounded text-xl font-bold shadow-lg shadow-black/40 whitespace-pre-wrap break-words inline-block max-w-[90%]">
                        {titleText}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="h-64 border-t border-white/10 glass-morphism p-6 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-4">
                <Clock className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-mono text-slate-400">00:00:00 / 00:00:00</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => handleAddImages()}
                  className="p-2 border border-white/10 rounded-md hover:bg-white/5 active:bg-white/10 transition-colors"
                  title="이미지 추가"
                >
                  <Plus className="w-4 h-4" />
                </button>
                <button
                  onClick={clearSlides}
                  className="p-2 border border-white/10 rounded-md hover:bg-white/5 active:bg-white/10 transition-colors text-slate-400 hover:text-red-400"
                  title="전체 삭제"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 bg-black/40 rounded-xl border border-white/5 p-4 flex gap-2 overflow-x-auto items-center">
              {slides.length === 0 ? (
                <div className="w-full italic text-slate-600 text-sm flex items-center justify-center">
                  Drop images here to build your timeline
                </div>
              ) : (
                slides.map((slide, idx) => (
                  <div key={slide.id} className="flex items-center gap-2">
                    <div
                      className="relative group flex-shrink-0 bg-slate-800 rounded-lg overflow-hidden border border-white/20 hover:border-primary transition-all"
                      style={{ width: `${slide.duration * 20}px`, minWidth: '80px', height: '100px' }}
                    >
                      <img src={slide.url} className="w-full h-full object-cover opacity-60" alt="" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 bg-black/40 transition-opacity">
                        <span className="text-xs font-bold">{slide.duration}s</span>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-primary/50" />
                    </div>
                    {idx < slides.length - 1 && (
                      <button
                        onClick={() => handleAddImages(idx)}
                        className="w-8 h-8 flex-shrink-0 rounded-full bg-white/5 flex items-center justify-center group hover:bg-white/10 transition-colors"
                      >
                        <Plus className="w-3 h-3 text-slate-500 group-hover:text-primary" />
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </main>
    </div >
  );
}
