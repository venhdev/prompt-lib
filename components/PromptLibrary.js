"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getAppUrl, supabase } from "../lib/supabase";
import packageJson from "../package.json";
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  diffSourcePlugin,
  toolbarPlugin,
  DiffSourceToggleWrapper,
  UndoRedo,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import {
  ArrowClockwise,
  ArrowsLeftRight,
  CaretDown,
  Check,
  CheckCircle,
  ClipboardText,
  Clock,
  Copy,
  DownloadSimple,
  FolderSimple,
  GitBranch,
  LockKey,
  Moon,
  EnvelopeSimple,
  User,
  Key,
  SignOut,
  MagnifyingGlass,
  Plus,
  SidebarSimple,
  Sparkle,
  Sun,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";

const clone = (value) => JSON.parse(JSON.stringify(value));

const APP_VERSION = packageJson.version;
const RECOVERY_INTENT_KEY = "prompt-lib:password-recovery";
const THEME_KEY = "prompt-lib:theme";

const MARKDOWN_PLUGINS = [
  headingsPlugin(),
  listsPlugin(),
  quotePlugin(),
  thematicBreakPlugin(),
  markdownShortcutPlugin(),
];

const EDITOR_PLUGINS = [
  ...MARKDOWN_PLUGINS,
  diffSourcePlugin({ viewMode: "rich-text" }),
  toolbarPlugin({
    toolbarContents: () => (
      <DiffSourceToggleWrapper>
        <UndoRedo />
      </DiffSourceToggleWrapper>
    ),
  }),
];

function newId() {
  return crypto.randomUUID();
}

function normalizePrompts(items) {
  return items.map((prompt) => {
    const versions = (Array.isArray(prompt.versions) ? prompt.versions : []).map((version) => ({
      id: version.id,
      content: typeof version.content === "string" ? version.content : "",
      createdAt: version.createdAt || new Date().toISOString(),
    }));
    return {
      id: prompt.id,
      title: typeof prompt.title === "string" ? prompt.title : "",
      description: typeof prompt.description === "string" ? prompt.description : "",
      draftContent: typeof prompt.draftContent === "string" ? prompt.draftContent : versions.at(-1)?.content || "",
      updatedAt: prompt.updatedAt || new Date().toISOString(),
      versions,
    };
  });
}

function formatTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Vừa xong";
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRelativeTime(value) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return "Vừa xong";
  const elapsedMinutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  if (elapsedMinutes < 1) return "Vừa xong";
  if (elapsedMinutes < 60) return `${elapsedMinutes} phút trước`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} giờ trước`;
  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays} ngày trước`;
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }).format(timestamp);
}

function ThemeToggle({ theme, onToggle }) {
  const isDark = theme === "dark";
  return (
    <button
      className="theme-toggle"
      onClick={onToggle}
      type="button"
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      title={`Switch to ${isDark ? "light" : "dark"} theme`}
    >
      {isDark ? <Sun size={17} /> : <Moon size={17} />}
    </button>
  );
}

export default function PromptLibrary() {
  const [prompts, setPrompts] = useState([]);
  const [selectedPromptId, setSelectedPromptId] = useState(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("editor");
  const [isEditing, setIsEditing] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [compareA, setCompareA] = useState(null);
  const [compareB, setCompareB] = useState(null);
  const [notice, setNotice] = useState("Đã tự động lưu");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [cloudError, setCloudError] = useState("");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadedUserId, setLoadedUserId] = useState(null);
  const [loginNotice, setLoginNotice] = useState("");
  const [authMode, setAuthMode] = useState(() => typeof window !== "undefined" && localStorage.getItem(RECOVERY_INTENT_KEY) === "true" ? "reset" : "login");
  const [pendingEmail, setPendingEmail] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(() => typeof window !== "undefined" && localStorage.getItem(RECOVERY_INTENT_KEY) === "true");
  const [theme, setTheme] = useState(() => {
    if (typeof window === "undefined") return "dark";
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "dark";
  });
  const [authForm, setAuthForm] = useState({ username: "", email: "", password: "", otp: "", newPassword: "" });
  const activeUserIdRef = useRef(null);
  const editorRef = useRef(null);
  const persistedVersionIdsRef = useRef(new Set());
  const syncQueueRef = useRef(Promise.resolve());

  const emailVerified = Boolean(session?.user?.email_confirmed_at);
  const username = session?.user?.user_metadata?.username || session?.user?.email?.split("@")[0] || "User";
  const userInitial = username.slice(0, 1).toUpperCase();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  function toggleTheme() {
    setTheme((currentTheme) => currentTheme === "dark" ? "light" : "dark");
  }

  useEffect(() => {
    activeUserIdRef.current = session?.user?.id || null;
  }, [session?.user?.id]);

  useEffect(() => {
    const mobile = window.matchMedia("(max-width: 720px)");
    const syncSidebar = (event) => setSidebarOpen(!event.matches);
    syncSidebar(mobile);
    mobile.addEventListener("change", syncSidebar);
    return () => mobile.removeEventListener("change", syncSidebar);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      activeUserIdRef.current = data.session?.user?.id || null;
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      activeUserIdRef.current = nextSession?.user?.id || null;
      if (event === "PASSWORD_RECOVERY") {
        localStorage.setItem(RECOVERY_INTENT_KEY, "true");
        setRecoveryMode(true);
        setAuthMode("reset");
      }
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setCloudReady(false);
    setCloudError("");
    setLoadedUserId(null);
    setPrompts([]);
    setSelectedPromptId(null);
    persistedVersionIdsRef.current = new Set();
    if (!session?.user || !emailVerified || recoveryMode) {
      return;
    }
    let cancelled = false;
    async function loadCloudLibrary() {
      setNotice("Đang đồng bộ cloud…");
      const { data, error } = await supabase
        .from("prompts")
        .select("id,title,description,draft_content,updated_at,prompt_versions(id,content,position,created_at)")
        .eq("owner_id", session.user.id)
        .order("updated_at", { ascending: false });
      if (cancelled) return;
      if (error) {
        setNotice("Không thể tải cloud");
        setCloudError(error.message);
        setLoadedUserId(session.user.id);
        return;
      }
      if (data?.length) {
        const cloudPrompts = data.map((prompt) => ({
          id: prompt.id,
          title: prompt.title,
          description: prompt.description || "",
          draftContent: prompt.draft_content || "",
          updatedAt: prompt.updated_at,
          versions: [...(prompt.prompt_versions || [])]
            .sort((a, b) => a.position - b.position)
            .map((version) => ({ id: version.id, content: version.content, createdAt: version.created_at })),
        }));
        persistedVersionIdsRef.current = new Set(cloudPrompts.flatMap((prompt) => prompt.versions.map((version) => version.id)));
        setPrompts(cloudPrompts);
        setSelectedPromptId(cloudPrompts[0].id);
      } else {
        setPrompts([]);
        setSelectedPromptId(null);
      }
      setLoadedUserId(session.user.id);
      setCloudReady(true);
      setNotice("Đã đồng bộ cloud");
    }
    loadCloudLibrary();
    return () => { cancelled = true; };
  }, [session?.user?.id, emailVerified, recoveryMode, loadAttempt]);

  useEffect(() => {
    setIsEditing(false);
    setAccountMenuOpen(false);
  }, [selectedPromptId]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!cloudReady || !session?.user || !emailVerified || recoveryMode || loadedUserId !== session.user.id) return;
      const userId = session.user.id;
      const snapshot = clone(prompts);
      const promptRows = snapshot.map((prompt) => ({
        id: prompt.id,
        owner_id: userId,
        title: prompt.title,
        description: prompt.description,
        draft_content: prompt.draftContent,
        updated_at: prompt.updatedAt,
      }));
      const versionRows = snapshot.flatMap((prompt) => prompt.versions.map((version, position) => ({
        id: version.id,
        prompt_id: prompt.id,
        content: version.content,
        position: position + 1,
        created_at: version.createdAt,
      })));
      syncQueueRef.current = syncQueueRef.current.then(async () => {
        if (activeUserIdRef.current !== userId) return;
        const { error: promptError } = promptRows.length
          ? await supabase.from("prompts").upsert(promptRows)
          : { error: null };
        const newVersionRows = versionRows.filter((version) => !persistedVersionIdsRef.current.has(version.id));
        const { error: versionError } = !promptError && newVersionRows.length
          ? await supabase.from("prompt_versions").insert(newVersionRows)
          : { error: null };
        let error = promptError || versionError;
        if (!promptError && !versionError) {
          newVersionRows.forEach((version) => persistedVersionIdsRef.current.add(version.id));
        }
        if (!error && activeUserIdRef.current === userId) {
          const { data: remotePrompts, error: listError } = await supabase.from("prompts").select("id").eq("owner_id", userId);
          error = listError;
          const stalePromptIds = (remotePrompts || []).map((row) => row.id).filter((id) => !snapshot.some((prompt) => prompt.id === id));
          if (!error && stalePromptIds.length) {
            const { error: deleteError } = await supabase.from("prompts").delete().in("id", stalePromptIds);
            error = deleteError;
          }
        }
        if (activeUserIdRef.current === userId) setNotice(error ? "Lỗi đồng bộ cloud" : "Đã đồng bộ cloud");
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [prompts, cloudReady, loadedUserId, session?.user?.id, emailVerified, recoveryMode]);

  function updateAuthField(field, value) {
    setAuthForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  async function returnToLogin() {
    localStorage.removeItem(RECOVERY_INTENT_KEY);
    setRecoveryMode(false);
    setAuthMode("login");
    setLoginNotice("");
    if (session) await supabase.auth.signOut();
  }

  function requestLogout() {
    setAccountMenuOpen(false);
    setConfirmLogout(true);
  }

  async function confirmSignOut() {
    setConfirmLogout(false);
    await supabase.auth.signOut();
  }

  async function resendVerification() {
    const email = pendingEmail || authForm.email.trim();
    if (!email) return;
    setLoginNotice("Đang gửi lại email…");
    const { error } = await supabase.auth.resend({
      type: "signup",
      email,
      options: { emailRedirectTo: getAppUrl() },
    });
    setLoginNotice(error ? error.message : "Đã gửi lại email xác minh.");
  }

  async function submitAuth(event) {
    event.preventDefault();
    setLoginNotice("Đang xử lý…");
    if (authMode === "register") {
      const email = authForm.email.trim();
      const username = authForm.username.trim();
      if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
        setLoginNotice("Username chỉ gồm chữ, số, dấu gạch dưới và dài 3–32 ký tự.");
        return;
      }
      const { data, error } = await supabase.auth.signUp({
        email,
        password: authForm.password,
        options: { data: { username }, emailRedirectTo: getAppUrl() },
      });
      if (error) {
        setLoginNotice(error.message);
        return;
      }
      if (!data.session || !data.user?.email_confirmed_at) {
        setPendingEmail(email);
        setAuthMode("verify-email");
        setLoginNotice("Tài khoản đã được tạo. Hãy xác minh email để tiếp tục.");
      }
      return;
    }
    if (authMode === "forgot") {
      const email = authForm.email.trim();
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false, emailRedirectTo: getAppUrl() },
      });
      if (!error) setAuthMode("verify");
      setLoginNotice(error ? error.message : "Mã OTP đã được gửi đến email của bạn.");
      return;
    }
    if (authMode === "verify") {
      setRecoveryMode(true);
      const { error } = await supabase.auth.verifyOtp({ email: authForm.email.trim(), token: authForm.otp.trim(), type: "email" });
      if (!error) {
        localStorage.setItem(RECOVERY_INTENT_KEY, "true");
        setAuthMode("reset");
      } else {
        setRecoveryMode(false);
      }
      setLoginNotice(error ? error.message : "OTP hợp lệ. Hãy đặt mật khẩu mới.");
      return;
    }
    if (authMode === "reset") {
      const { error } = await supabase.auth.updateUser({ password: authForm.newPassword });
      if (error) {
        setLoginNotice(error.message);
        return;
      }
      localStorage.removeItem(RECOVERY_INTENT_KEY);
      setRecoveryMode(false);
      setAuthMode("login");
      setNotice("Đã cập nhật mật khẩu");
      return;
    }
    const email = authForm.email.trim();
    const { error } = await supabase.auth.signInWithPassword({ email, password: authForm.password });
    if (error?.code === "email_not_confirmed") {
      setPendingEmail(email);
      setAuthMode("verify-email");
      setLoginNotice("Email chưa được xác minh.");
      return;
    }
    setLoginNotice(error ? error.message : "Đăng nhập thành công.");
  }

  const selectedPrompt = prompts.find((prompt) => prompt.id === selectedPromptId) || prompts[0] || null;
  const latestVersion = selectedPrompt?.versions?.at(-1) || null;
  const filtered = prompts.filter((prompt) => `${prompt.title} ${prompt.description}`.toLowerCase().includes(query.toLowerCase()));
  const hasVersionChanges = Boolean(selectedPrompt && selectedPrompt.draftContent !== latestVersion?.content);
  const canSaveVersion = Boolean(selectedPrompt?.draftContent.trim() && hasVersionChanges);
  const nextVersionNumber = (selectedPrompt?.versions.length || 0) + 1;
  const saveVersionLabel = latestVersion && !hasVersionChanges ? "Không có thay đổi" : `Lưu thành v${nextVersionNumber}`;

  useEffect(() => {
    if (!selectedPrompt) return;
    setCompareA(selectedPrompt.versions[Math.max(0, selectedPrompt.versions.length - 2)]?.id || null);
    setCompareB(selectedPrompt.versions.at(-1)?.id || null);
  }, [selectedPromptId, selectedPrompt?.versions.length]);

  function updateDraft(content) {
    if (!selectedPrompt || !isEditing) return;
    setNotice("Đang lưu…");
    setPrompts((items) => items.map((prompt) => prompt.id !== selectedPrompt.id ? prompt : {
      ...prompt,
      draftContent: content,
      updatedAt: new Date().toISOString(),
    }));
  }

  function updatePromptDetails(fields) {
    if (!selectedPrompt || !isEditing) return;
    setNotice("Đang lưu…");
    setPrompts((items) => items.map((prompt) => prompt.id === selectedPrompt.id
      ? { ...prompt, ...fields, updatedAt: new Date().toISOString() }
      : prompt));
  }

  async function pasteMarkdown() {
    if (!isEditing || !editorRef.current) return;
    if (!navigator.clipboard?.readText) {
      setNotice("Trình duyệt không cho phép đọc clipboard");
      return;
    }
    try {
      const markdown = await navigator.clipboard.readText();
      if (!markdown) {
        setNotice("Clipboard đang trống");
        return;
      }
      editorRef.current.focus();
      editorRef.current.insertMarkdown(markdown);
      setNotice("Đã dán Markdown");
    } catch {
      setNotice("Không thể đọc clipboard");
    }
  }

  function createPrompt() {
    const id = newId();
    const prompt = {
      id,
      title: "",
      description: "",
      draftContent: "",
      updatedAt: new Date().toISOString(),
      versions: [],
    };
    setPrompts((items) => [prompt, ...items]);
    setSelectedPromptId(id);
    setTab("editor");
    setIsEditing(true);
    setSidebarOpen(false);
    setNotice("Draft mới đã tạo");
  }

  function selectPrompt(id) {
    setSelectedPromptId(id);
    setSidebarOpen(false);
  }

  function saveVersion() {
    if (!selectedPrompt || !canSaveVersion) return;
    const version = { id: newId(), content: selectedPrompt.draftContent, createdAt: new Date().toISOString() };
    setPrompts((items) => items.map((prompt) => prompt.id === selectedPrompt.id
      ? { ...prompt, versions: [...prompt.versions, version], updatedAt: new Date().toISOString() }
      : prompt));
    setNotice(`Đã lưu v${nextVersionNumber}`);
  }

  function duplicatePrompt() {
    if (!selectedPrompt) return;
    const copy = {
      id: newId(),
      title: `${selectedPrompt.title || "Untitled prompt"} copy`,
      description: selectedPrompt.description,
      draftContent: selectedPrompt.draftContent,
      updatedAt: new Date().toISOString(),
      versions: [],
    };
    setPrompts((items) => [copy, ...items]);
    setSelectedPromptId(copy.id);
    setNotice("Đã nhân bản draft");
  }

  function deletePrompt() {
    if (!selectedPrompt || !window.confirm(`Xóa prompt “${selectedPrompt.title || "Untitled prompt"}”? Hành động này không thể hoàn tác.`)) return;
    const next = prompts.filter((prompt) => prompt.id !== selectedPrompt.id);
    setPrompts(next);
    setSelectedPromptId(next[0]?.id || null);
    setNotice("Đã xóa prompt");
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(prompts, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "prompt-library-backup.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!Array.isArray(parsed) || !parsed.length) throw new Error();
        const imported = normalizePrompts(parsed).map((prompt) => ({
          ...prompt,
          id: newId(),
          updatedAt: new Date().toISOString(),
          versions: prompt.versions.map((version) => ({ ...version, id: newId() })),
        }));
        setPrompts(imported);
        setSelectedPromptId(imported[0].id);
        setNotice("Đã nhập dữ liệu");
      } catch { setNotice("File không hợp lệ"); }
    };
    reader.readAsText(file);
  }

  const versionA = selectedPrompt?.versions.find((version) => version.id === compareA) || selectedPrompt?.versions[0] || null;
  const versionB = selectedPrompt?.versions.find((version) => version.id === compareB) || latestVersion;
  const changedLines = useMemo(() => {
    const a = versionA?.content.split("\n") || [];
    const b = versionB?.content.split("\n") || [];
    return Math.max(a.length, b.length) - a.filter((line, index) => line === b[index]).length;
  }, [versionA, versionB]);

  if (!authReady) {
    return <main className="auth-screen"><ThemeToggle theme={theme} onToggle={toggleTheme} /><div className="auth-card"><div className="brand-mark"><Sparkle size={22} weight="fill" /></div><h1>Prompt Library</h1><p>Đang kiểm tra phiên đăng nhập…</p></div></main>;
  }

  if (authMode === "verify-email" || (session && !emailVerified && !recoveryMode)) {
    return (
      <main className="auth-screen">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <div className="auth-card">
          <div className="brand-mark"><EnvelopeSimple size={22} weight="fill" /></div>
          <span className="eyebrow">VERIFY YOUR EMAIL</span>
          <h1>Kiểm tra email</h1>
          <p>
            Xác minh <strong>{pendingEmail || session?.user?.email}</strong> để đăng nhập và sử dụng thư viện prompt.
            Trước khi xác minh, tài khoản không thể đọc hoặc thay đổi dữ liệu.
          </p>
          <button className="button primary auth-button" onClick={resendVerification}><EnvelopeSimple size={17} /> Gửi lại email</button>
          {loginNotice && <small>{loginNotice}</small>}
          <div className="auth-switch"><button onClick={returnToLogin}>Quay lại đăng nhập</button></div>
          <span className="auth-version">v{APP_VERSION}</span>
        </div>
      </main>
    );
  }

  if (!session || recoveryMode) {
    const isRegister = authMode === "register";
    const isOtp = authMode === "verify";
    const isReset = authMode === "reset";
    return (
      <main className="auth-screen">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <div className="auth-card">
          <div className="brand-mark"><Sparkle size={22} weight="fill" /></div>
          <span className="eyebrow">YOUR PROMPT COLLECTION</span>
          <h1>Prompt Library</h1>
          <p>{isRegister ? "Tạo tài khoản để lưu prompt riêng của bạn." : authMode === "forgot" ? "Nhập email để nhận mã khôi phục." : isOtp ? "Nhập mã OTP trong email." : isReset ? "Đặt mật khẩu mới cho tài khoản." : "Đăng nhập để truy cập thư viện prompt của bạn."}</p>
          <form className="auth-form" onSubmit={submitAuth}>
            {isRegister && <label><User size={18} /><input required minLength="3" maxLength="32" value={authForm.username} onChange={(e) => updateAuthField("username", e.target.value)} placeholder="Username" autoComplete="username" /></label>}
            {!isReset && <label><EnvelopeSimple size={18} /><input required type="email" value={authForm.email} onChange={(e) => updateAuthField("email", e.target.value)} placeholder="Email" autoComplete="email" /></label>}
            {(authMode === "login" || isRegister) && <label><Key size={18} /><input required minLength="8" type="password" value={authForm.password} onChange={(e) => updateAuthField("password", e.target.value)} placeholder="Password" autoComplete={isRegister ? "new-password" : "current-password"} /></label>}
            {isOtp && <label><LockKey size={18} /><input required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={authForm.otp} onChange={(e) => updateAuthField("otp", e.target.value)} placeholder="6-digit OTP" /></label>}
            {isReset && <label><Key size={18} /><input required minLength="8" type="password" value={authForm.newPassword} onChange={(e) => updateAuthField("newPassword", e.target.value)} placeholder="New password" autoComplete="new-password" /></label>}
            <button className="button primary auth-button" type="submit"><LockKey size={18} weight="fill" /> {isRegister ? "Đăng ký" : authMode === "forgot" ? "Gửi OTP" : isOtp ? "Xác minh OTP" : isReset ? "Đổi mật khẩu" : "Đăng nhập"}</button>
          </form>
          {loginNotice && <small>{loginNotice}</small>}
          <div className="auth-switch">
            {authMode === "login" ? <><button onClick={() => { setAuthMode("register"); setLoginNotice(""); }}>Tạo tài khoản</button><span>•</span><button onClick={() => { setAuthMode("forgot"); setLoginNotice(""); }}>Quên mật khẩu?</button></> : <button onClick={returnToLogin}>Quay lại đăng nhập</button>}
          </div>
          <span className="auth-version">v{APP_VERSION}</span>
        </div>
      </main>
    );
  }

  if (cloudError && loadedUserId === session.user.id) {
    return (
      <main className="auth-screen">
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <div className="auth-card">
          <div className="brand-mark"><ArrowClockwise size={22} /></div>
          <h1>Không thể tải dữ liệu</h1>
          <p>Kết nối tới thư viện cloud thất bại. App chưa ghi hoặc thay đổi dữ liệu nào.</p>
          <button className="button primary auth-button" onClick={() => setLoadAttempt((value) => value + 1)}>Thử lại</button>
          <div className="auth-switch"><button onClick={() => { if (window.confirm("Đăng xuất khỏi Prompt Library?")) supabase.auth.signOut(); }}>Đăng xuất</button></div>
        </div>
      </main>
    );
  }

  if (!cloudReady || loadedUserId !== session.user.id) {
    return <main className="auth-screen"><ThemeToggle theme={theme} onToggle={toggleTheme} /><div className="auth-card"><div className="brand-mark"><Sparkle size={22} weight="fill" /></div><h1>Prompt Library</h1><p>Đang tải thư viện của bạn…</p></div></main>;
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <button className="icon-button mobile-only" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle sidebar"><SidebarSimple size={19} /></button>
          <div className="brand-mark"><Sparkle size={18} weight="fill" /></div>
          <div><strong>Prompt Library</strong><span>{session.user.user_metadata?.username || session.user.email}</span></div>
        </div>
        <div className="top-actions">
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
          <span className="save-state"><Check size={14} weight="bold" /> {notice}</span>
          <label className="button ghost file-button"><UploadSimple size={16} /> Import<input type="file" accept="application/json" onChange={importData} /></label>
          <button className="button ghost" onClick={exportData}><DownloadSimple size={16} /> Export</button>
          <div className="account-menu">
            <button className="account-trigger" onClick={() => setAccountMenuOpen((open) => !open)} aria-expanded={accountMenuOpen} aria-label="Mở menu tài khoản">
              <span className="account-avatar">{userInitial}</span>
              <span className="account-copy"><strong>{username}</strong><small>{session.user.email}</small></span>
              <CaretDown size={15} />
            </button>
            {accountMenuOpen && <div className="account-dropdown">
              <div className="account-dropdown-user"><strong>{username}</strong><span>{session.user.email}</span></div>
              <button onClick={requestLogout}><SignOut size={16} /> Đăng xuất</button>
            </div>}
          </div>
        </div>
      </header>

      <div className={`workspace ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
        <button className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-label="Đóng danh sách prompt" />
        <aside className="sidebar">
          <div className="sidebar-heading"><span>Prompt library</span><span className="count">{prompts.length}</span></div>
          <div className="search"><MagnifyingGlass size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm prompt…" /></div>
          <button className="button primary full" onClick={createPrompt}><Plus size={17} weight="bold" /> Prompt mới</button>
          <div className="prompt-list">
            {filtered.map((prompt) => (
              <button key={prompt.id} className={`prompt-card ${prompt.id === selectedPrompt?.id ? "active" : ""}`} onClick={() => selectPrompt(prompt.id)}>
                <div className="prompt-title"><FolderSimple size={17} weight={prompt.id === selectedPrompt?.id ? "fill" : "regular"} /><strong>{prompt.title || "Untitled prompt"}</strong></div>
                <p>{prompt.description || "Chưa có mô tả"}</p>
                <div className="card-meta"><span>{prompt.versions.length} versions</span><span>{formatRelativeTime(prompt.updatedAt)}</span></div>
              </button>
            ))}
          </div>
          <div className="sidebar-footer">
            <span className="app-version">Prompt Library · v{APP_VERSION}</span>
          </div>
        </aside>

        <section className="main-panel">
          {!selectedPrompt ? (
            <div className="empty-state">
              <div className="brand-mark"><Sparkle size={22} weight="fill" /></div>
              <h2>Thư viện đang trống</h2>
              <p>Tạo prompt đầu tiên hoặc import file backup của bạn.</p>
              <button className="button primary" onClick={createPrompt}><Plus size={17} weight="bold" /> Tạo prompt đầu tiên</button>
            </div>
          ) : <>
          <div className="prompt-header">
            <div className="title-area">
              <div className="eyebrow">PROMPT / {isEditing ? "EDITING" : "READONLY"}</div>
              {isEditing ? <>
                <input className="title-input" value={selectedPrompt.title} onChange={(e) => updatePromptDetails({ title: e.target.value })} placeholder="Untitled prompt" aria-label="Tên prompt" />
                <input className="description-input" value={selectedPrompt.description} onChange={(e) => updatePromptDetails({ description: e.target.value })} placeholder="Mô tả mục tiêu của prompt…" aria-label="Mô tả prompt" />
              </> : <>
                <h1 className="prompt-title-heading">{selectedPrompt.title || "Untitled prompt"}</h1>
                <p className="prompt-description-text">{selectedPrompt.description || "Chưa có mô tả"}</p>
              </>}
            </div>
            <div className="header-actions">
              <button className="icon-button" onClick={duplicatePrompt} title="Duplicate" aria-label="Nhân bản prompt"><Copy size={17} /></button>
              <button className="icon-button danger" onClick={deletePrompt} title="Delete" aria-label="Xóa prompt"><Trash size={17} /></button>
              {isEditing ? <><button className="button ghost header-done" onClick={() => setIsEditing(false)}>Xong</button><button className="button dark" onClick={saveVersion} disabled={!canSaveVersion} title={!selectedPrompt.draftContent.trim() ? "Nhập nội dung trước khi lưu version" : saveVersionLabel}><GitBranch size={17} /> {saveVersionLabel}</button></> : <button className="button primary" onClick={() => setIsEditing(true)}><Key size={17} /> Chỉnh sửa</button>}
            </div>
          </div>

          <nav className="tabs">
            <button className={tab === "editor" ? "active" : ""} onClick={() => setTab("editor")}>Editor</button>
            <button className={tab === "compare" ? "active" : ""} onClick={() => setTab("compare")}><ArrowsLeftRight size={15} /> Compare</button>
          </nav>

          {tab === "editor" && (
            <div className="editor-layout">
              <div className="editor-card">
                <div className="card-toolbar">
                  <div className="version-select"><span className={`status-dot ${hasVersionChanges ? "dirty" : ""}`} />{isEditing ? "Working draft" : "Readonly view"}<span className="muted">• {hasVersionChanges ? "Có thay đổi mới" : latestVersion ? `Khớp v${selectedPrompt.versions.length}` : "Chưa có version"}</span></div>
                  <div className="toolbar-right"><span>{selectedPrompt.draftContent.length} chars</span>{isEditing && <button className="tiny-button" onClick={pasteMarkdown} title="Parse clipboard content as Markdown"><ClipboardText size={14} /> Paste Markdown</button>}<button className="tiny-button" onClick={() => navigator.clipboard.writeText(selectedPrompt.draftContent)}><Copy size={14} /> Copy</button></div>
                </div>
                {isEditing ? <MDXEditor ref={editorRef} key={`edit-${selectedPrompt.id}`} markdown={selectedPrompt.draftContent} onChange={updateDraft} plugins={EDITOR_PLUGINS} aria-label="Markdown prompt editor" /> : <MDXEditor ref={editorRef} key={`view-${selectedPrompt.id}`} markdown={selectedPrompt.draftContent || "_Chưa có nội dung._"} plugins={MARKDOWN_PLUGINS} readOnly aria-label="Readonly prompt preview" />}
                <div className="editor-footer"><span><CheckCircle size={15} weight="fill" /> {isEditing ? "Draft đã tự động lưu" : "Readonly · Chưa chỉnh sửa"}</span><span>{isEditing ? "Markdown · MDXEditor" : "Markdown preview"}</span></div>
              </div>
              <aside className="version-rail">
                <div className="rail-title"><span>Version history</span><Clock size={16} /></div>
                <div className="timeline">
                  {!selectedPrompt.versions.length ? (
                    <div className="timeline-empty"><strong>Chưa có version</strong><span>Chỉnh draft rồi chọn “Lưu thành v1”.</span></div>
                  ) : [...selectedPrompt.versions].reverse().map((version, index) => {
                    const versionNumber = selectedPrompt.versions.length - index;
                    return (
                      <button key={version.id} className={index === 0 ? "version-item current" : "version-item"} onClick={() => { setCompareA(version.id === latestVersion.id ? selectedPrompt.versions.at(-2)?.id || version.id : version.id); setCompareB(latestVersion.id); setTab("compare"); }}>
                        <span className="timeline-dot" />
                        <div><strong>v{versionNumber}{index === 0 && <span className="latest-badge">Latest</span>}</strong><span>Immutable snapshot</span><small>{formatTimestamp(version.createdAt)}</small></div>
                      </button>
                    );
                  })}
                </div>
              </aside>
            </div>
          )}

          {tab === "compare" && (
            <div className="compare-view">
              {selectedPrompt.versions.length < 2 ? (
                <div className="compare-empty"><ArrowsLeftRight size={22} /><h3>Cần ít nhất 2 version</h3><p>Lưu thêm một version sau khi chỉnh draft để bắt đầu so sánh.</p></div>
              ) : <>
                <div className="compare-summary"><div><ArrowsLeftRight size={18} /><strong>{changedLines} dòng thay đổi</strong><span>So sánh nội dung giữa hai version</span></div><button className="button ghost" onClick={() => { const temp = compareA; setCompareA(compareB); setCompareB(temp); }}><ArrowClockwise size={16} /> Đổi bên</button></div>
                <div className="diff-grid">
                  {[{ side: "A", version: versionA, setter: setCompareA }, { side: "B", version: versionB, setter: setCompareB }].map(({ side, version, setter }) => (
                    <div className="diff-card" key={side}>
                      <div className="diff-head"><span className={`side-label side-${side.toLowerCase()}`}>{side}</span><select value={version.id} onChange={(e) => setter(e.target.value)}>{selectedPrompt.versions.map((candidate, index) => <option key={candidate.id} value={candidate.id}>v{index + 1}{index === selectedPrompt.versions.length - 1 ? " — Latest" : ""}</option>)}</select></div>
                      <pre>{version.content.split("\n").map((line, index) => <span key={index} className={`diff-line ${(side === "A" ? versionB : versionA)?.content.split("\n")[index] !== line ? "changed" : ""}`}><i className="diff-line-number">{index + 1}</i><code className="diff-line-content">{line || " "}</code></span>)}</pre>
                    </div>
                  ))}
                </div>
              </>}
            </div>
          )}
          </>}
        </section>
      </div>
      {confirmLogout && <div className="dialog-backdrop" role="presentation">
        <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="logout-dialog-title">
          <h2 id="logout-dialog-title">Đăng xuất?</h2>
          <p>Phiên làm việc hiện tại sẽ được đóng trên thiết bị này.</p>
          <div className="dialog-actions"><button className="button ghost" onClick={() => setConfirmLogout(false)}>Hủy</button><button className="button primary" onClick={confirmSignOut}>Đăng xuất</button></div>
        </section>
      </div>}
    </main>
  );
}
