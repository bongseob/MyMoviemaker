import { useState, useEffect } from 'react';
import { X, Save, CheckCircle2 } from 'lucide-react';

interface Prompts {
    gov: string;
    corporate: string;
    column: string;
    event: string;
}

interface PromptSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function PromptSettingsModal({ isOpen, onClose }: PromptSettingsModalProps) {
    const [prompts, setPrompts] = useState<Prompts>({
        gov: '',
        corporate: '',
        column: '',
        event: ''
    });
    const [isSaving, setIsSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        if (isOpen && window.electron?.getPrompts) {
            window.electron.getPrompts().then((data: Prompts) => {
                if (data) setPrompts(data);
            });
            setSaveSuccess(false);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSave = async () => {
        setIsSaving(true);
        if (window.electron?.savePrompts) {
            await window.electron.savePrompts(prompts);
            setSaveSuccess(true);
            setTimeout(() => setSaveSuccess(false), 2000);
        }
        setIsSaving(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-slate-900 border border-white/10 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl">
                <div className="flex items-center justify-between p-6 border-b border-white/10">
                    <h2 className="text-xl font-bold text-white">프롬프트 설정</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
                        <X className="w-6 h-6" />
                    </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-300">행정/구청 기사 프롬프트</label>
                        <textarea
                            value={prompts.gov}
                            onChange={(e) => setPrompts(prev => ({ ...prev, gov: e.target.value }))}
                            className="w-full h-32 bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:border-primary outline-none transition-all text-white resize-none"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-300">기업 홍보 기사 프롬프트</label>
                        <textarea
                            value={prompts.corporate}
                            onChange={(e) => setPrompts(prev => ({ ...prev, corporate: e.target.value }))}
                            className="w-full h-32 bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:border-primary outline-none transition-all text-white resize-none"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-300">제도/칼럼 기사 프롬프트</label>
                        <textarea
                            value={prompts.column}
                            onChange={(e) => setPrompts(prev => ({ ...prev, column: e.target.value }))}
                            className="w-full h-32 bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:border-primary outline-none transition-all text-white resize-none"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-sm font-bold text-slate-300">연주회/행사 기사 프롬프트</label>
                        <textarea
                            value={prompts.event}
                            onChange={(e) => setPrompts(prev => ({ ...prev, event: e.target.value }))}
                            className="w-full h-32 bg-black/40 border border-white/10 rounded-lg p-3 text-sm focus:border-primary outline-none transition-all text-white resize-none"
                        />
                    </div>
                </div>

                <div className="p-6 border-t border-white/10 flex items-center justify-end gap-4">
                    {saveSuccess && (
                        <span className="text-emerald-400 text-sm flex items-center gap-1 font-medium">
                            <CheckCircle2 className="w-4 h-4" /> 저장되었습니다
                        </span>
                    )}
                    <button
                        onClick={onClose}
                        className="px-6 py-2 rounded-lg text-sm font-bold text-slate-400 hover:text-white hover:bg-white/5 transition-all"
                    >
                        닫기
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-primary hover:bg-primary/80 text-white px-6 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2"
                    >
                        <Save className="w-4 h-4" />
                        {isSaving ? '저장 중...' : '저장'}
                    </button>
                </div>
            </div>
        </div>
    );
}
