"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";
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

const seedPrompts = [
  {
    id: "optimizer",
    title: "Prompt Optimizer",
    description: "Refine rough requests without changing their intent.",
    tags: ["Writing", "System"],
    updated: "2 phút trước",
    versions: [
      {
        id: "opt-v1",
        name: "v1 — Baseline",
        note: "Initial concise optimizer",
        created: "09:14",
        content: "You are a Prompt Optimizer. Improve the user's input only when it meaningfully increases clarity. Preserve the original intent and requirements exactly. Return the shortest, clearest version in clean Markdown.",
      },
      {
        id: "opt-v2",
        name: "v2 — Guardrails",
        note: "Added scope and output constraints",
        created: "09:42",
        content: "You are a Prompt Optimizer. Improve the user's input only when it meaningfully increases clarity.\n\nRules:\n- Preserve the original intent and requirements exactly.\n- Do not expand the scope.\n- Remove redundancy and irrelevant noise.\n- Keep technical context needed to diagnose the task.\n\nReturn only the optimized prompt in clean Markdown.",
      },
      {
        id: "opt-v3",
        name: "v3 — Current",
        note: "Added quality gate and stricter format",
        created: "10:08",
        content: "You are a Prompt Optimizer. Improve the user's input only when it meaningfully increases clarity.\n\nRules:\n- Preserve intent, requirements, and scope exactly.\n- Improve grammar, structure, brevity, and signal-to-noise ratio.\n- Remove unrelated output, but retain errors and evidence useful for diagnosis.\n- Write in English using clean Markdown.\n\nIf quality is already at least 90%, return only: `Quality: X%, Your prompt is already clear.` Otherwise, return a score, one short reason, and the optimized prompt.",
      },
    ],
  },
  {
    id: "explainer",
    title: "Technical Explainer",
    description: "Explain engineering concepts in concise Vietnamese.",
    tags: ["Education"],
    updated: "Hôm qua",
    versions: [
      { id: "ex-v1", name: "v1 — Current", note: "Concise bilingual style", created: "Hôm qua", content: "Explain technical concepts concisely in Vietnamese while preserving relevant English keywords. Start with a plain-language definition, then give one practical example and the key trade-off." },
    ],
  },
  {
    id: "reviewer",
    title: "Code Reviewer",
    description: "Find correctness and maintainability risks first.",
    tags: ["Development"],
    updated: "3 ngày trước",
    versions: [
      { id: "rev-v1", name: "v1 — Current", note: "Risk-first review", created: "3 ngày trước", content: "Review the code for correctness, security, and maintainability. Lead with concrete findings ordered by severity. Cite the affected file and line. Avoid style-only comments unless they hide a real risk." },
    ],
  },
];

const clone = (value) => JSON.parse(JSON.stringify(value));

const OWNER_EMAIL = "venhha.it@gmail.com";
const APP_VERSION = packageJson.version;

function newId() {
  return crypto.randomUUID();
}

function freshPrompts() {
  return clone(seedPrompts).map((prompt) => ({
    ...prompt,
    id: newId(),
    versions: prompt.versions.map((version) => ({ ...version, id: newId() })),
  }));
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
  const [prompts, setPrompts] = useState(seedPrompts);
  const [activeId, setActiveId] = useState("optimizer");
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("editor");
  const [compareA, setCompareA] = useState("opt-v2");
  const [compareB, setCompareB] = useState("opt-v3");
  const [notice, setNotice] = useState("Đã tự động lưu");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [session, setSession] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [cloudReady, setCloudReady] = useState(false);
  const [loginNotice, setLoginNotice] = useState("");
  const [authMode, setAuthMode] = useState("login");
  const [authForm, setAuthForm] = useState({ username: "", email: "", password: "", otp: "", newPassword: "" });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) {
      setCloudReady(false);
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
        const userKey = `prompt-lib-data:${session.user.id}`;
        const legacy = session.user.email === OWNER_EMAIL
          ? localStorage.getItem("prompt-lib-data") || localStorage.getItem("prompt-lab-data")
          : null;
        let initial;
        try { initial = legacy ? normalizePrompts(JSON.parse(legacy)) : freshPrompts(); } catch { initial = freshPrompts(); }
        initial = initial.map((prompt) => ({ ...prompt, id: newId(), versions: prompt.versions.map((version) => ({ ...version, id: newId() })) }));
        localStorage.setItem(userKey, JSON.stringify(initial));
        setPrompts(initial);
        setActiveId(initial[0].id);
      }
      setCloudReady(true);
      setNotice("Đã đồng bộ cloud");
    }
    loadCloudLibrary();
    return () => { cancelled = true; };
  }, [session?.user?.id]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!session?.user) return;
      localStorage.setItem(`prompt-lib-data:${session.user.id}`, JSON.stringify(prompts));
      if (!cloudReady || !session?.user) {
        setNotice("Đã lưu cục bộ");
        return;
      }
      const promptRows = prompts.map((prompt) => ({
        id: prompt.id,
        owner_id: session.user.id,
        title: prompt.title,
        description: prompt.description,
        tags: prompt.tags,
        updated_label: prompt.updated,
      }));
      const versionRows = prompts.flatMap((prompt) => prompt.versions.map((version, position) => ({
        id: version.id,
        prompt_id: prompt.id,
        name: version.name,
        note: version.note,
        created_label: version.created,
        content: version.content,
        position,
      })));
      supabase.from("prompts").upsert(promptRows).then(async ({ error: promptError }) => {
        const { error: versionError } = promptError
          ? { error: null }
          : await supabase.from("prompt_versions").upsert(versionRows);
        const error = promptError || versionError;
        if (!error) {
          const { data: remotePrompts } = await supabase.from("prompts").select("id");
          const stalePromptIds = (remotePrompts || []).map((row) => row.id).filter((id) => !prompts.some((prompt) => prompt.id === id));
          if (stalePromptIds.length) await supabase.from("prompts").delete().in("id", stalePromptIds);
        }
        setNotice(error ? "Lỗi đồng bộ cloud" : "Đã đồng bộ cloud");
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [prompts, cloudReady, session?.user?.id]);

  function updateAuthField(field, value) {
    setAuthForm((currentForm) => ({ ...currentForm, [field]: value }));
  }

  async function submitAuth(event) {
    event.preventDefault();
    setLoginNotice("Đang xử lý…");
    if (authMode === "register") {
      const { error } = await supabase.auth.signUp({
        email: authForm.email.trim(),
        password: authForm.password,
        options: { data: { username: authForm.username.trim() }, emailRedirectTo: window.location.origin },
      });
      setLoginNotice(error ? error.message : "Đăng ký thành công. Hãy xác nhận email nếu được yêu cầu.");
      return;
    }
    if (authMode === "forgot") {
      const { error } = await supabase.auth.signInWithOtp({
        email: authForm.email.trim(),
        options: { shouldCreateUser: false },
      });
      if (!error) setAuthMode("verify");
      setLoginNotice(error ? error.message : "Mã OTP đã được gửi đến email của bạn.");
      return;
    }
    if (authMode === "verify") {
      const { error } = await supabase.auth.verifyOtp({ email: authForm.email.trim(), token: authForm.otp.trim(), type: "email" });
      if (!error) setAuthMode("reset");
      setLoginNotice(error ? error.message : "OTP hợp lệ. Hãy đặt mật khẩu mới.");
      return;
    }
    if (authMode === "reset") {
      const { error } = await supabase.auth.updateUser({ password: authForm.newPassword });
      setLoginNotice(error ? error.message : "Đã cập nhật mật khẩu.");
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: authForm.email.trim(), password: authForm.password });
    setLoginNotice(error ? error.message : "Đăng nhập thành công.");
  }

  const active = prompts.find((prompt) => prompt.id === activeId) || prompts[0];
  const current = active.versions[active.versions.length - 1];
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
    if (prompts.length === 1) return;
    const next = prompts.filter((prompt) => prompt.id !== active.id);
    setPrompts(next);
    setActiveId(next[0].id);
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

  const versionA = active.versions.find((version) => version.id === compareA) || active.versions[0];
  const versionB = active.versions.find((version) => version.id === compareB) || current;
  const changedLines = useMemo(() => {
    const a = versionA?.content.split("\n") || [];
    const b = versionB?.content.split("\n") || [];
    return Math.max(a.length, b.length) - a.filter((line, index) => line === b[index]).length;
  }, [versionA, versionB]);

  if (!authReady) {
    return <main className="auth-screen"><div className="auth-card"><div className="brand-mark"><Sparkle size={22} weight="fill" /></div><h1>Prompt Library</h1><p>Đang kiểm tra phiên đăng nhập…</p></div></main>;
  }

  if (!session) {
    const isRegister = authMode === "register";
    const isOtp = authMode === "verify";
    const isReset = authMode === "reset";
    return <main className="auth-screen"><div className="auth-card"><div className="brand-mark"><Sparkle size={22} weight="fill" /></div><span className="eyebrow">YOUR PROMPT COLLECTION</span><h1>Prompt Library</h1><p>{isRegister ? "Tạo tài khoản để lưu prompt riêng của bạn." : authMode === "forgot" ? "Nhập email để nhận mã khôi phục." : isOtp ? "Nhập mã OTP trong email." : isReset ? "Đặt mật khẩu mới cho tài khoản." : "Đăng nhập để truy cập thư viện prompt của bạn."}</p><form className="auth-form" onSubmit={submitAuth}>{isRegister && <label><User size={16} /><input required minLength="3" maxLength="32" value={authForm.username} onChange={(e) => updateAuthField("username", e.target.value)} placeholder="Username" autoComplete="username" /></label>}{!isReset && <label><EnvelopeSimple size={16} /><input required type="email" value={authForm.email} onChange={(e) => updateAuthField("email", e.target.value)} placeholder="Email" autoComplete="email" /></label>}{(authMode === "login" || isRegister) && <label><Key size={16} /><input required minLength="8" type="password" value={authForm.password} onChange={(e) => updateAuthField("password", e.target.value)} placeholder="Password" autoComplete={isRegister ? "new-password" : "current-password"} /></label>}{isOtp && <label><LockKey size={16} /><input required inputMode="numeric" pattern="[0-9]{6}" maxLength="6" value={authForm.otp} onChange={(e) => updateAuthField("otp", e.target.value)} placeholder="6-digit OTP" /></label>}{isReset && <label><Key size={16} /><input required minLength="8" type="password" value={authForm.newPassword} onChange={(e) => updateAuthField("newPassword", e.target.value)} placeholder="New password" autoComplete="new-password" /></label>}<button className="button primary auth-button" type="submit"><LockKey size={17} weight="fill" /> {isRegister ? "Đăng ký" : authMode === "forgot" ? "Gửi OTP" : isOtp ? "Xác minh OTP" : isReset ? "Đổi mật khẩu" : "Đăng nhập"}</button></form>{loginNotice && <small>{loginNotice}</small>}<div className="auth-switch">{authMode === "login" ? <><button onClick={() => { setAuthMode("register"); setLoginNotice(""); }}>Tạo tài khoản</button><span>•</span><button onClick={() => { setAuthMode("forgot"); setLoginNotice(""); }}>Quên mật khẩu?</button></> : <button onClick={() => { setAuthMode("login"); setLoginNotice(""); }}>Quay lại đăng nhập</button>}</div><span className="auth-version">v{APP_VERSION}</span></div></main>;
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
              <button key={prompt.id} className={`prompt-card ${prompt.id === active.id ? "active" : ""}`} onClick={() => setActiveId(prompt.id)}>
                <div className="prompt-title"><FolderSimple size={17} weight={prompt.id === active.id ? "fill" : "regular"} /><strong>{prompt.title}</strong></div>
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
          <div className="prompt-header">
            <div className="title-area">
              <div className="eyebrow">PROMPT / {active.tags[0].toUpperCase()}</div>
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

        </section>
      </div>
    </main>
  );
}
