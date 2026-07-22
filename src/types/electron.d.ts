import type { ArticleSummary } from '../components/ArticleSummarizer';

type DialogFilter = {
  name: string;
  extensions: string[];
};

type OpenDialogOptions = {
  title?: string;
  properties?: string[];
  filters?: DialogFilter[];
};

type SaveDialogOptions = {
  title?: string;
  defaultPath?: string;
  outputSection?: string;
  autoIncrementExisting?: boolean;
  buttonLabel?: string;
  properties?: string[];
  filters?: DialogFilter[];
};

type OpenDialogResult = {
  canceled: boolean;
  filePaths: string[];
};

type SaveDialogResult = {
  canceled: boolean;
  filePath?: string;
};

type IpcResult<T = unknown> = {
  success?: boolean;
  canceled?: boolean;
  error?: string;
  data?: T;
  savedPath?: string;
  outputPath?: string;
  message?: string;
  isAuthenticated?: boolean;
};

type ExportVideoPayload = {
  slides: Array<{
    id: string;
    url: string;
    path: string;
    duration: number;
  }>;
  audioPath: string | null;
  outputPath: string;
  aspectRatio?: '16:9' | '9:16';
  titleText: string;
  titlePosition: 'top' | 'center' | 'bottom';
  targetDuration: number;
  imageDuration: number;
  subtitlePath: string | null;
  subtitleTextContent: string;
};

type YoutubeAuthConfig = {
  clientId?: string;
  clientSecret?: string;
};

type YoutubeUploadPayload = {
  videoPath: string;
  title: string;
  description: string;
  privacyStatus: 'public' | 'private' | 'unlisted';
};

type TiktokUploadPayload = {
  videoPath: string;
  caption: string;
  autoPost: boolean;
};

type InstagramUploadPayload = {
  videoPath: string;
  caption: string;
  autoShare: boolean;
};

type RefineSubtitlesPayload = {
  srtPath: string;
  summaryText: string;
};

type SaveSrtContentPayload = {
  srtPath: string;
  content: string;
};

type GenerateSrtPayload = {
  mp3Path?: string | null;
};

interface ElectronApi {
  selectFiles: (options: OpenDialogOptions) => Promise<OpenDialogResult>;
  selectSrtFile: () => Promise<OpenDialogResult>;
  selectSavePath: (options: SaveDialogOptions) => Promise<SaveDialogResult>;
  exportVideo: (data: ExportVideoPayload) => Promise<void>;
  onProgress: (callback: (value: number) => void) => void;
  getPathForFile: (file: File) => string;
  openAudioFile: (filePath: string) => Promise<IpcResult>;
  minimize: () => void;
  close: () => void;
  youtubeSetupAuth: (config?: YoutubeAuthConfig) => Promise<IpcResult>;
  youtubeLogin: () => Promise<IpcResult>;
  youtubeLogout: () => Promise<IpcResult>;
  youtubeClearToken: () => Promise<IpcResult>;
  youtubeUpload: (data: YoutubeUploadPayload) => Promise<IpcResult>;
  onYoutubeUploadProgress: (callback: (value: number) => void) => void;
  getPrompts: () => Promise<{gov: string, corporate: string, column: string, event: string}>;
  savePrompts: (data: {gov: string, corporate: string, column: string, event: string}) => Promise<IpcResult>;
  processArticle: (text: string, articleType?: string) => Promise<IpcResult<ArticleSummary>>;
  loadArticleResult: () => Promise<IpcResult<ArticleSummary>>;
  publishArticle: (articleData: ArticleSummary) => Promise<IpcResult>;
  onPublishStatus: (callback: (status: string) => void) => void;
  removePublishStatusListener: () => void;
  generateSunoSong: (articleData: ArticleSummary) => Promise<IpcResult>;
  onSunoStatus: (callback: (status: string) => void) => void;
  removeSunoStatusListener: () => void;
  prepareTiktokUpload: (data: TiktokUploadPayload) => Promise<IpcResult>;
  onTiktokStatus: (callback: (status: string) => void) => void;
  removeTiktokStatusListener: () => void;
  prepareInstagramUpload: (data: InstagramUploadPayload) => Promise<IpcResult>;
  onInstagramStatus: (callback: (status: string) => void) => void;
  removeInstagramStatusListener: () => void;
  generateSrtFromSuno: (data?: GenerateSrtPayload) => Promise<IpcResult & { sourcePath?: string }>;
  saveSrtContent: (data: SaveSrtContentPayload) => Promise<IpcResult>;
  refineSubtitles: (data: RefineSubtitlesPayload) => Promise<IpcResult>;
  onRefineStatus: (callback: (status: string) => void) => void;
  removeRefineStatusListener: () => void;
}

declare global {
  interface Window {
    electron?: ElectronApi;
  }
}

export {};
