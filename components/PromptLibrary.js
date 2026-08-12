"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getAppUrl, supabase } from "../lib/supabase";
import packageJson from "../package.json";
import {
  ArrowClockwise,
  ArrowsLeftRight,
  Check,
  CheckCircle,
  Clock,
  Copy,
  DownloadSimple,
  FolderSimple,
  GitBranch,
  LockKey,
  EnvelopeSimple,
  User,
  Key,
  SignOut,
  MagnifyingGlass,
  Plus,
  SidebarSimple,
  Sparkle,
  Trash,
  UploadSimple,
} from "@phosphor-icons/react";

const clone = (value) => JSON.parse(JSON.stringify(value));

const APP_VERSION = packageJson.version;
const RECOVERY_INTENT_KEY = "prompt-lib:password-recovery";

function newId() {
  return crypto.randomUUID();
}

function normalizePrompts(items) {
  return items.map((prompt) => ({
    id: prompt.id,
    title: prompt.title,
    description: prompt.description,
    tags: prompt.tags,
    updated: prompt.updated,
    versions: prompt.versions,
  }));
}

export default function PromptLibrary() {
  const [prompts, setPrompts] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("editor");
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
  const [authForm, setAuthForm] = useState({ username: "", email: "", password: "", otp: "", newPassword: "" });
  const activeUserIdRef = useRef(null);
  const syncQueueRef = useRef(Promise.resolve());

  const emailVerified = Boolean(session?.user?.email_confirmed_at);

  useEffect(() => {
    activeUserIdRef.current = session?.user?.id || null;
  }, [session?.user?.id]);

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
    setActiveId(null);
    if (!session?.user || !emailVerified || recoveryMode) {
      return;
    }
    let cancelled = false;
    async function loadCloudLibrary() {
      setNotice("Đang đồng bộ cloud…");
      const { data, error } = await supabase
        .from("prompts")
        .select("id,title,description,tags,updated_label,prompt_versions(id,name,note,created_label,content,position)")
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
          tags: prompt.tags || [],
          updated: prompt.updated_label || "vừa xong",
          versions: [...prompt.prompt_versions]
            .sort((a, b) => a.position - b.position)
            .map((version) => ({ id: version.id, name: version.name, note: version.note || "", created: version.created_label || "Bây giờ", content: version.content })),
        }));
        setPrompts(cloudPrompts);
        setActiveId(cloudPrompts[0].id);
      } else {
        setPrompts([]);
        setActiveId(null);
      }
      setLoadedUserId(session.user.id);
      setCloudReady(true);
      setNotice("Đã đồng bộ cloud");
    }
    loadCloudLibrary();
    return () => { cancelled = true; };
  }, [session?.user?.id, emailVerified, recoveryMode, loadAttempt]);

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
        tags: prompt.tags,
        updated_label: prompt.updated,
      }));
      const versionRows = snapshot.flatMap((prompt) => prompt.versions.map((version, position) => ({
        id: version.id,
        prompt_id: prompt.id,
        name: version.name,
        note: version.note,
        created_label: version.created,
        content: version.content,
        position,
      })));
      syncQueueRef.current = syncQueueRef.current.then(async () => {
        if (activeUserIdRef.current !== userId) return;
        const { error: promptError } = promptRows.length
          ? await supabase.from("prompts").upsert(promptRows)
          : { error: null };
        const { error: versionError } = !promptError && versionRows.length
          ? await supabase.from("prompt_versions").upsert(versionRows)
          : { error: null };
        let error = promptError || versionError;
        if (!error && activeUserIdRef.current === userId) {
          const { data: remotePrompts, error: listError } = await supabase.from("prompts").select("id");
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

  const active = prompts.find((prompt) => prompt.id === activeId) || prompts[0] || null;
  const current = active?.versions?.[active.versions.length - 1] || null;
  const filtered = prompts.filter((prompt) => `${prompt.title} ${prompt.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));

  useEffect(() => {
    if (!active) return;
    setCompareA(active.versions[Math.max(0, active.versions.length - 2)]?.id);
    setCompareB(active.versions[active.versions.length - 1]?.id);
  }, [activeId]);

  function updateCurrent(content) {
    setNotice("Đang lưu…");
    setPrompts((items) => items.map((prompt) => prompt.id !== active.id ? prompt : {
      ...prompt,
      versions: prompt.versions.map((version) => version.id === current.id ? { ...version, content } : version),
      updated: "vừa xong",
    }));
  }

  function createPrompt() {
    const id = newId();
    const prompt = {
      id,
      title: "Untitled prompt",
      description: "Mô tả mục tiêu của prompt.",
      tags: ["Draft"],
      updated: "vừa xong",
      versions: [{ id: newId(), name: "v1 — Draft", note: "Initial draft", created: "Bây giờ", content: "Describe the role, goal, constraints, and expected output." }],
    };
    setPrompts((items) => [prompt, ...items]);
    setActiveId(id);
  }

  function saveVersion() {
    const version = { ...current, id: newId(), name: `v${active.versions.length + 1} — Current`, note: "Manual checkpoint", created: "Bây giờ" };
    setPrompts((items) => items.map((prompt) => prompt.id === active.id ? { ...prompt, versions: [...prompt.versions, version], updated: "vừa xong" } : prompt));
    setNotice("Đã tạo version mới");
  }

  function duplicatePrompt() {
    const copy = clone(active);
    copy.id = newId();
    copy.title = `${active.title} copy`;
    copy.updated = "vừa xong";
    copy.versions = copy.versions.map((version) => ({ ...version, id: newId() }));
    setPrompts((items) => [copy, ...items]);
    setActiveId(copy.id);
  }

  function deletePrompt() {
    const next = prompts.filter((prompt) => prompt.id !== active.id);
    setPrompts(next);
    setActiveId(next[0]?.id || null);
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
          versions: prompt.versions.map((version) => ({ ...version, id: newId() })),
        }));
        setPrompts(imported);
        setActiveId(imported[0].id);
        setNotice("Đã nhập dữ liệu");
      } catch { setNotice("File không hợp lệ"); }
    };
    reader.readAsText(file);
  }

  const versionA = active?.versions.find((version) => version.id === compareA) || active?.versions[0] || null;
  const versionB = active?.versions.find((version) => version.id === compareB) || current;
  const changedLines = useMemo(() => {
    const a = versionA?.content.split("\n") || [];
    const b = versionB?.content.split("\n") || [];
    return Math.max(a.length, b.length) - a.filter((line, index) => line === b[index]).length;
  }, [versionA, versionB]);

  if (!authReady) {
    return <main className="auth-screen"><div className="auth-card"><div className="brand-mark"><Sparkle size={22} weight="fill" /></div><h1>Prompt Library</h1><p>Đang kiểm tra phiên đăng nhập…</p></div></main>;
  }

  if (authMode === "verify-email" || (session && !emailVerified && !recoveryMode)) {
    return (
      <main className="auth-screen">
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
        <div className="auth-card">
          <div className="brand-mark"><ArrowClockwise size={22} /></div>
          <h1>Không thể tải dữ liệu</h1>
          <p>Kết nối tới thư viện cloud thất bại. App chưa ghi hoặc thay đổi dữ liệu nào.</p>
          <button className="button primary auth-button" onClick={() => setLoadAttempt((value) => value + 1)}>Thử lại</button>
          <div className="auth-switch"><button onClick={() => supabase.auth.signOut()}>Đăng xuất</button></div>
        </div>
      </main>
    );
  }

  if (!cloudReady || loadedUserId !== session.user.id) {
    return <main className="auth-screen"><div className="auth-card"><div className="brand-mark"><Sparkle size={22} weight="fill" /></div><h1>Prompt Library</h1><p>Đang tải thư viện của bạn…</p></div></main>;
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
          <span className="save-state"><Check size={14} weight="bold" /> {notice}</span>
          <label className="button ghost file-button"><UploadSimple size={16} /> Import<input type="file" accept="application/json" onChange={importData} /></label>
          <button className="button ghost" onClick={exportData}><DownloadSimple size={16} /> Export</button>
          <div className="privacy-pill"><LockKey size={14} weight="fill" /> Chỉ mình bạn</div>
          <button className="icon-button top-signout" onClick={() => supabase.auth.signOut()} title="Đăng xuất"><SignOut size={16} /></button>
        </div>
      </header>

      <div className={`workspace ${sidebarOpen ? "" : "sidebar-collapsed"}`}>
        <aside className="sidebar">
          <div className="sidebar-heading"><span>Prompt library</span><span className="count">{prompts.length}</span></div>
          <div className="search"><MagnifyingGlass size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm prompt…" /></div>
          <button className="button primary full" onClick={createPrompt}><Plus size={17} weight="bold" /> Prompt mới</button>
          <div className="prompt-list">
            {filtered.map((prompt) => (
              <button key={prompt.id} className={`prompt-card ${prompt.id === active?.id ? "active" : ""}`} onClick={() => setActiveId(prompt.id)}>
                <div className="prompt-title"><FolderSimple size={17} weight={prompt.id === active?.id ? "fill" : "regular"} /><strong>{prompt.title}</strong></div>
                <p>{prompt.description}</p>
                <div className="card-meta"><span>{prompt.versions.length} versions</span><span>{prompt.updated}</span></div>
              </button>
            ))}
          </div>
          <div className="sidebar-footer">
            <div className="sidebar-tip"><span className="tip-icon">⌘</span><div><strong>Mẹo nhanh</strong><span>Chọn Copy để dùng prompt ngay</span></div></div>
            <span className="app-version">Prompt Library · v{APP_VERSION}</span>
          </div>
        </aside>

        <section className="main-panel">
          {!active ? (
            <div className="empty-state">
              <div className="brand-mark"><Sparkle size={22} weight="fill" /></div>
              <h2>Thư viện đang trống</h2>
              <p>Tạo prompt đầu tiên hoặc import file backup của bạn.</p>
              <button className="button primary" onClick={createPrompt}><Plus size={17} weight="bold" /> Tạo prompt đầu tiên</button>
            </div>
          ) : <>
          <div className="prompt-header">
            <div className="title-area">
              <div className="eyebrow">PROMPT / {active.tags[0]?.toUpperCase() || "UNTAGGED"}</div>
              <input className="title-input" value={active.title} onChange={(e) => setPrompts((items) => items.map((p) => p.id === active.id ? { ...p, title: e.target.value } : p))} />
              <input className="description-input" value={active.description} onChange={(e) => setPrompts((items) => items.map((p) => p.id === active.id ? { ...p, description: e.target.value } : p))} />
            </div>
            <div className="header-actions">
              <button className="icon-button" onClick={duplicatePrompt} title="Duplicate"><Copy size={17} /></button>
              <button className="icon-button danger" onClick={deletePrompt} title="Delete"><Trash size={17} /></button>
              <button className="button dark" onClick={saveVersion}><GitBranch size={17} /> Lưu version</button>
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
                  <div className="version-select"><span className="status-dot" />{current.name}<span className="muted">• {current.created}</span></div>
                  <div className="toolbar-right"><span>{current.content.length} chars</span><button className="tiny-button" onClick={() => navigator.clipboard.writeText(current.content)}><Copy size={14} /> Copy</button></div>
                </div>
                <textarea className="prompt-editor" value={current.content} onChange={(e) => updateCurrent(e.target.value)} spellCheck="false" />
                <div className="editor-footer"><span><CheckCircle size={15} weight="fill" /> Version hiện tại</span><span>Plain text · UTF-8</span></div>
              </div>
              <aside className="version-rail">
                <div className="rail-title"><span>Version history</span><Clock size={16} /></div>
                <div className="timeline">
                  {[...active.versions].reverse().map((version, index) => (
                    <button key={version.id} className={index === 0 ? "version-item current" : "version-item"} onClick={() => { setCompareA(version.id); setCompareB(current.id); setTab("compare"); }}>
                      <span className="timeline-dot" />
                      <div><strong>{version.name}</strong><span>{version.note}</span><small>{version.created}</small></div>
                    </button>
                  ))}
                </div>
              </aside>
            </div>
          )}

          {tab === "compare" && (
            <div className="compare-view">
              <div className="compare-summary"><div><ArrowsLeftRight size={18} /><strong>{changedLines} dòng thay đổi</strong><span>So sánh nội dung giữa hai version</span></div><button className="button ghost" onClick={() => { const temp = compareA; setCompareA(compareB); setCompareB(temp); }}><ArrowClockwise size={16} /> Đổi bên</button></div>
              <div className="diff-grid">
                {[{ side: "A", version: versionA, setter: setCompareA }, { side: "B", version: versionB, setter: setCompareB }].map(({ side, version, setter }) => (
                  <div className="diff-card" key={side}>
                    <div className="diff-head"><span className={`side-label side-${side.toLowerCase()}`}>{side}</span><select value={version.id} onChange={(e) => setter(e.target.value)}>{active.versions.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
                    <pre>{version.content.split("\n").map((line, index) => <span key={index} className={(side === "A" ? versionB : versionA)?.content.split("\n")[index] !== line ? "changed" : ""}><i>{index + 1}</i>{line || " "}</span>)}</pre>
                  </div>
                ))}
              </div>
            </div>
          )}
          </>}
        </section>
      </div>
    </main>
  );
}
