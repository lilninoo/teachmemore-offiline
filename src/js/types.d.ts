interface ElectronAPI {
  getDeviceId(): Promise<string>;
  getAppPath(): Promise<string>;
  getAppVersion(): Promise<string>;
  checkAutoLogin(): Promise<any>;
  store: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<{success: boolean}>;
    delete(key: string): Promise<{success: boolean}>;
    clear(): Promise<{success: boolean}>;
  };
  api: {
    login(apiUrl: string, username: string, password: string): Promise<any>;
    logout(): Promise<any>;
    refreshToken(): Promise<any>;
    verifySubscription(): Promise<any>;
    getCourses(page?: number, perPage?: number): Promise<any>;
    getUserCourses(filters?: any): Promise<any>;
    getCourseDetails(courseId: number): Promise<any>;
    downloadCourse(courseId: number, options?: any): Promise<any>;
    getLessonContent(lessonId: number): Promise<any>;
    syncProgress(progressData: any): Promise<any>;
    getMediaInfo(courseId: number): Promise<any>;
    downloadMedia(mediaUrl: string, lessonId: number): Promise<any>;
  };
  download: {
    downloadCourse(courseId: number, options?: any): Promise<any>;
    cancelDownload(downloadId: string): Promise<any>;
    pauseDownload(downloadId: string): Promise<any>;
    resumeDownload(downloadId: string): Promise<any>;
    getAllDownloads(): Promise<any>;
    getDownloadStatus(downloadId: string): Promise<any>;
    removeFromHistory(downloadId: string): Promise<any>;
  };
  db: {
    saveCourse(data: any): Promise<any>;
    getCourse(courseId: number): Promise<any>;
    getAllCourses(): Promise<any>;
    updateCourseAccess(courseId: number): Promise<any>;
    deleteCourse(courseId: number): Promise<any>;
    searchCourses(query: string): Promise<any>;
    getCourseProgress(courseId: number): Promise<any>;
    saveSection(data: any): Promise<any>;
    getSections(courseId: number): Promise<any>;
    saveLesson(data: any): Promise<any>;
    getLesson(lessonId: number): Promise<any>;
    getLessons(sectionId: number): Promise<any>;
    updateLessonProgress(lessonId: number, progress: number, completed: boolean): Promise<any>;
    saveMedia(data: any): Promise<any>;
    getMedia(mediaId: string): Promise<any>;
    getMediaByLesson(lessonId: number): Promise<any>;
    getLessonMedia(lessonId: number): Promise<any>;
    getLessonWithMedia(lessonId: number): Promise<any>;
    saveQuiz(data: any): Promise<any>;
    getQuiz(quizId: number): Promise<any>;
    saveQuizAttempt(quizId: number, answers: any, score: number): Promise<any>;
    getUnsyncedItems(): Promise<any>;
    markAsSynced(syncIds: number[]): Promise<any>;
    addToSyncQueue(entityType: string, entityId: number, action: string, data?: any): Promise<any>;
    getExpiredCourses(): Promise<any>;
    cleanupExpiredData(): Promise<any>;
    getStats(): Promise<any>;
    getLogs(options?: any): Promise<any>;
    openLogsFolder(): Promise<any>;
    log(level: string, message: string, data?: any): void;
  };
  media: {
    createStreamUrl(encryptedPath: string, mimeType?: string): Promise<any>;
    decryptFile(encryptedPath: string, outputPath: string): Promise<any>;
    createStream(filePath: string, mimeType?: string): Promise<any>;
  };
  file: {
    readFile(filePath: string): Promise<any>;
    writeFile(filePath: string, data: string): Promise<any>;
    exists(filePath: string): Promise<boolean>;
    createDirectory(dirPath: string): Promise<any>;
    deleteFile(filePath: string): Promise<any>;
    getMediaPath(filename: string): Promise<string>;
  };
  dialog: {
    showSaveDialog(options: any): Promise<any>;
    showOpenDialog(options: any): Promise<any>;
    showMessageBox(options: any): Promise<any>;
    showErrorBox(title: string, content: string): Promise<any>;
  };
  checkInternet(): Promise<boolean>;
  logError(error: any): Promise<any>;
  reportError(error: any): Promise<any>;
  saveLog(logEntry: any): Promise<any>;
  openExternal(url: string): Promise<any>;
  getMembershipRestrictions(): Promise<any>;
  checkFeatureAccess(feature: string): Promise<boolean>;
  showNotification(options: any): Promise<any>;
  exportCertificatePdf(certificateData: any): Promise<any>;
  on(channel: string, callback: (...args: any[]) => void): boolean;
  off(channel: string): void;
  send(channel: string, ...args: any[]): void;
}

interface CryptoUtils {
  generateId(): string;
  hash(text: string): Promise<string | null>;
  uuid(): string;
}

interface PlatformInfo {
  isWindows: boolean;
  isMac: boolean;
  isLinux: boolean;
  arch: string;
  versions: { node: string; chrome: string; electron: string };
  getKeyboardShortcut(action: string): string;
}

interface AppLogger {
  log(message: string, data?: any): void;
  warn(message: string, data?: any): void;
  error(message: string, error?: any): void;
  debug(message: string, data?: any): void;
}

interface Window {
  electronAPI: ElectronAPI;
  cryptoUtils: CryptoUtils;
  platform: PlatformInfo;
  Logger: AppLogger;
  Utils: any;
  AppConfig: any;
  showError(message: string): void;
  showSuccess(message: string): void;
  showWarning(message: string): void;
  showInfo(message: string): void;
}
