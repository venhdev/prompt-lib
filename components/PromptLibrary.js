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
  DotsThreeVertical,
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
  PencilSimple,
  SidebarSimple,
  Sparkle,
  Sun,
  Trash,
  UploadSimple,
  X,
} from "@phosphor-icons/react";

const clone = (value) => JSON.parse(JSON.stringify(value));

const APP_VERSION = packageJson.version;
const RECOVERY_INTENT_KEY = "prompt-lib:password-recovery";
const THEME_KEY = "prompt-lib:theme";
const LOCAL_DRAFT_KEY_PREFIX = "prompt-lib:local-draft:";

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

function deriveTitle(markdown) {
  const firstMeaningfulLine = String(markdown || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstMeaningfulLine) return "";
  const title = firstMeaningfulLine
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^>\s+/, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return "";
  return title.length > 60 ? `${title.slice(0, 59).trimEnd()}…` : title;
}

function displayTitle(prompt) {
  return prompt.title || deriveTitle(prompt.draftContent) || "Untitled prompt";
}

function normalizeTagName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "-").slice(0, 32);
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
      titleAuto: false,
      description: typeof prompt.description === "string" ? prompt.description : "",
      draftContent: typeof prompt.draftContent === "string" ? prompt.draftContent : versions.at(-1)?.content || "",
      folderId: prompt.folderId || null,
      tagIds: Array.isArray(prompt.tagIds) ? prompt.tagIds : [],
      updatedAt: prompt.updatedAt || new Date().toISOString(),
      versions,
      localOnly: false,
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
  const [folders, setFolders] = useState([]);
  const [tags, setTags] = useState([]);
  const [selectedPromptId, setSelectedPromptId] = useState(null);
  const [query, setQuery] = useState("");
  const [activeFolderId, setActiveFolderId] = useState(null);
  const [selectedTagIds, setSelectedTagIds] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [tab, setTab] = useState("editor");
  const [isEditing, setIsEditing] = useState(false);
  const [pendingPromptId, setPendingPromptId] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
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
  const editSnapshotRef = useRef(null);
  const persistedVersionIdsRef = useRef(new Set());
  const syncQueueRef = useRef(Promise.resolve());

  const emailVerified = Boolean(session?.user?.email_confirmed_at);
  const username = session?.user?.user_metadata?.username || session?.user?.email?.split("@")[0] || "User";
  const userInitial = username.slice(0, 1).toUpperCase();
  const localDraftKey = session?.user?.id ? `${LOCAL_DRAFT_KEY_PREFIX}${session.user.id}` : null;

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
    setFolders([]);
    setTags([]);
    setSelectedPromptId(null);
    persistedVersionIdsRef.current = new Set();
    if (!session?.user || !emailVerified || recoveryMode) {
      return;
    }
    let cancelled = false;
    async function loadCloudLibrary() {
      setNotice("Đang đồng bộ cloud…");
      const userId = session.user.id;
      const [{ data, error }, { data: folderData, error: folderError }, { data: tagData, error: tagError }, { data: relationData, error: relationError }] = await Promise.all([
        supabase.from("prompts").select("id,title,description,draft_content,folder_id,updated_at,prompt_versions(id,content,position,created_at)").eq("owner_id", userId).order("updated_at", { ascending: false }),
        supabase.from("folders").select("id,name,position,created_at,updated_at").eq("owner_id", userId).order("position").order("name"),
        supabase.from("tags").select("id,name,normalized_name,created_at,updated_at").eq("owner_id", userId).order("normalized_name"),
        supabase.from("prompt_tags").select("prompt_id,tag_id").eq("owner_id", userId),
      ]);
      if (cancelled) return;
      if (error || folderError || tagError || relationError) {
        setNotice("Không thể tải cloud");
        setCloudError((error || folderError || tagError || relationError).message);
        setLoadedUserId(userId);
        return;
      }
      const tagIdsByPrompt = (relationData || []).reduce((result, relation) => {
        result[relation.prompt_id] = [...(result[relation.prompt_id] || []), relation.tag_id];
        return result;
      }, {});
      setFolders((folderData || []).map((folder) => ({ id: folder.id, name: folder.name, position: folder.position, createdAt: folder.created_at, updatedAt: folder.updated_at })));
      setTags((tagData || []).map((tag) => ({ id: tag.id, name: tag.name, normalizedName: tag.normalized_name, createdAt: tag.created_at, updatedAt: tag.updated_at })));
      const cloudPrompts = (data || []).map((prompt) => ({
          id: prompt.id,
          title: prompt.title,
          titleAuto: false,
          description: prompt.description || "",
          draftContent: prompt.draft_content || "",
          folderId: prompt.folder_id || null,
          tagIds: tagIdsByPrompt[prompt.id] || [],
          updatedAt: prompt.updated_at,
          localOnly: false,
          versions: [...(prompt.prompt_versions || [])]
            .sort((a, b) => a.position - b.position)
            .map((version) => ({ id: version.id, content: version.content, createdAt: version.created_at })),
        }));
      let localDraft = null;
      if (localDraftKey) {
        try {
          const storedDraft = JSON.parse(localStorage.getItem(localDraftKey) || "null");
          if (storedDraft && !String(storedDraft.draftContent || "").trim()) {
            localDraft = { id: storedDraft.id || newId(), title: "", titleAuto: true, description: typeof storedDraft.description === "string" ? storedDraft.description : "", draftContent: "", folderId: null, tagIds: [], updatedAt: storedDraft.updatedAt || new Date().toISOString(), versions: [], localOnly: true };
          } else if (storedDraft) localStorage.removeItem(localDraftKey);
        } catch { localStorage.removeItem(localDraftKey); }
      }
      const loadedPrompts = localDraft ? [localDraft, ...cloudPrompts] : cloudPrompts;
      persistedVersionIdsRef.current = new Set(cloudPrompts.flatMap((prompt) => prompt.versions.map((version) => version.id)));
      setPrompts(loadedPrompts);
      setSelectedPromptId(loadedPrompts[0]?.id || null);
      setActiveFolderId(null);
      setSelectedTagIds([]);
      setLoadedUserId(userId);
      setCloudReady(true);
      setNotice("Đã đồng bộ cloud");
    }
    loadCloudLibrary();
    return () => { cancelled = true; };
  }, [session?.user?.id, emailVerified, recoveryMode, loadAttempt, localDraftKey]);

  useEffect(() => {
    if (!cloudReady || !localDraftKey) return;
    const localDraft = prompts.find((prompt) => prompt.localOnly);
    if (!localDraft) {
      localStorage.removeItem(localDraftKey);
      return;
    }
    localStorage.setItem(localDraftKey, JSON.stringify({
      id: localDraft.id,
      description: localDraft.description,
      draftContent: localDraft.draftContent,
      updatedAt: localDraft.updatedAt,
    }));
  }, [prompts, cloudReady, localDraftKey]);

  useEffect(() => {
    setAccountMenuOpen(false);
  }, [selectedPromptId]);

  useEffect(() => {
    if (!contextMenu) return undefined;
    const closeMenu = () => setContextMenu(null);
    const closeOnEscape = (event) => {
      if (event.key === "Escape") closeMenu();
    };
    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeMenu);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!cloudReady || !session?.user || !emailVerified || recoveryMode || loadedUserId !== session.user.id) return;
      const userId = session.user.id;
      const snapshot = clone(prompts).filter((prompt) => !prompt.localOnly);
      const folderRows = clone(folders).map((folder, position) => ({ id: folder.id, owner_id: userId, name: folder.name, position, updated_at: folder.updatedAt }));
      const tagRows = clone(tags).map((tag) => ({ id: tag.id, owner_id: userId, name: tag.name, normalized_name: tag.normalizedName, updated_at: tag.updatedAt }));
      const promptRows = snapshot.map((prompt) => ({
        id: prompt.id,
        owner_id: userId,
        title: prompt.title,
        description: prompt.description,
        draft_content: prompt.draftContent,
        folder_id: prompt.folderId || null,
        updated_at: prompt.updatedAt,
      }));
      const relationRows = snapshot.flatMap((prompt) => (prompt.tagIds || []).map((tagId) => ({ owner_id: userId, prompt_id: prompt.id, tag_id: tagId })));
      const versionRows = snapshot.flatMap((prompt) => prompt.versions.map((version, position) => ({
        id: version.id,
        prompt_id: prompt.id,
        content: version.content,
        position: position + 1,
        created_at: version.createdAt,
      })));
      syncQueueRef.current = syncQueueRef.current.then(async () => {
        if (activeUserIdRef.current !== userId) return;
        const { error: folderError } = folderRows.length ? await supabase.from("folders").upsert(folderRows) : { error: null };
        const { error: tagError } = !folderError && tagRows.length ? await supabase.from("tags").upsert(tagRows) : { error: null };
        const { error: promptError } = !folderError && !tagError && promptRows.length
          ? await supabase.from("prompts").upsert(promptRows)
          : { error: null };
        const newVersionRows = versionRows.filter((version) => !persistedVersionIdsRef.current.has(version.id));
        const { error: versionError } = !promptError && newVersionRows.length
          ? await supabase.from("prompt_versions").insert(newVersionRows)
          : { error: null };
        let error = folderError || tagError || promptError || versionError;
        if (!promptError && !versionError) {
          newVersionRows.forEach((version) => persistedVersionIdsRef.current.add(version.id));
        }
        if (!error && activeUserIdRef.current === userId) {
          const { data: remotePrompts, error: listError } = await supabase.from("prompts").select("id").eq("owner_id", userId);
          error = listError;
          const remotePromptIds = (remotePrompts || []).map((row) => row.id);
          const { error: relationDeleteError } = remotePromptIds.length ? await supabase.from("prompt_tags").delete().in("prompt_id", remotePromptIds) : { error: null };
          error = relationDeleteError;
          const { error: relationInsertError } = !error && relationRows.length ? await supabase.from("prompt_tags").insert(relationRows) : { error: null };
          error = relationInsertError;
          const stalePromptIds = remotePromptIds.filter((id) => !snapshot.some((prompt) => prompt.id === id));
          if (!error && stalePromptIds.length) {
            const { error: deleteError } = await supabase.from("prompts").delete().in("id", stalePromptIds);
            error = deleteError;
          }
          const { data: remoteFolders, error: folderListError } = !error ? await supabase.from("folders").select("id").eq("owner_id", userId) : { data: [], error: null };
          error = folderListError;
          const staleFolderIds = (remoteFolders || []).map((row) => row.id).filter((id) => !folderRows.some((folder) => folder.id === id));
          if (!error && staleFolderIds.length) {
            const { error: deleteError } = await supabase.from("folders").delete().in("id", staleFolderIds);
            error = deleteError;
          }
          const { data: remoteTags, error: tagListError } = !error ? await supabase.from("tags").select("id").eq("owner_id", userId) : { data: [], error: null };
          error = tagListError;
          const staleTagIds = (remoteTags || []).map((row) => row.id).filter((id) => !tagRows.some((tag) => tag.id === id));
          if (!error && staleTagIds.length) {
            const { error: deleteError } = await supabase.from("tags").delete().in("id", staleTagIds);
            error = deleteError;
          }
        }
        if (activeUserIdRef.current === userId) setNotice(error ? "Lỗi đồng bộ cloud" : "Đã đồng bộ cloud");
      });
    }, 350);
    return () => clearTimeout(timer);
  }, [prompts, folders, tags, cloudReady, loadedUserId, session?.user?.id, emailVerified, recoveryMode]);

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
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  const filtered = prompts.filter((prompt) => {
    const searchText = [displayTitle(prompt), prompt.description, folderById.get(prompt.folderId)?.name, ...(prompt.tagIds || []).map((id) => tagById.get(id)?.name)].filter(Boolean).join(" ").toLowerCase();
    const matchesQuery = !query.trim() || searchText.includes(query.trim().toLowerCase());
    const matchesFolder = activeFolderId === "__unfiled__" ? !prompt.folderId : !activeFolderId || prompt.folderId === activeFolderId;
    const matchesTags = !selectedTagIds.length || selectedTagIds.some((id) => (prompt.tagIds || []).includes(id));
    return matchesQuery && matchesFolder && matchesTags;
  });
  const hasVersionChanges = Boolean(selectedPrompt && selectedPrompt.draftContent !== latestVersion?.content);
  const hasEditChanges = Boolean(isEditing && selectedPrompt && editSnapshotRef.current && (
    selectedPrompt.title !== editSnapshotRef.current.title
    || selectedPrompt.description !== editSnapshotRef.current.description
    || selectedPrompt.draftContent !== editSnapshotRef.current.draftContent
    || selectedPrompt.folderId !== editSnapshotRef.current.folderId
    || JSON.stringify(selectedPrompt.tagIds || []) !== JSON.stringify(editSnapshotRef.current.tagIds || [])
  ));
  const canSaveVersion = Boolean(selectedPrompt?.draftContent.trim() && hasEditChanges);
  const nextVersionNumber = (selectedPrompt?.versions.length || 0) + 1;
  const saveVersionLabel = `Lưu thành v${nextVersionNumber}`;

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
      title: prompt.titleAuto ? deriveTitle(content) : prompt.title,
      localOnly: prompt.localOnly && !content.trim(),
      updatedAt: new Date().toISOString(),
    }));
  }

  function updatePromptDetails(fields) {
    if (!selectedPrompt || !isEditing) return;
    setNotice("Đang lưu…");
    setPrompts((items) => items.map((prompt) => prompt.id === selectedPrompt.id
      ? { ...prompt, ...fields, titleAuto: Object.hasOwn(fields, "title") ? false : prompt.titleAuto, updatedAt: new Date().toISOString() }
      : prompt));
  }

  function createFolder() {
    const name = window.prompt("Tên folder mới")?.trim();
    if (!name) return;
    if (folders.some((folder) => folder.name.toLowerCase() === name.toLowerCase())) return setNotice("Folder đã tồn tại");
    const now = new Date().toISOString();
    setFolders((items) => [...items, { id: newId(), name: name.slice(0, 80), position: items.length, createdAt: now, updatedAt: now }]);
  }

  function renameFolder(folder) {
    const name = window.prompt("Đổi tên folder", folder.name)?.trim();
    if (!name || name.toLowerCase() === folder.name.toLowerCase()) return;
    if (folders.some((item) => item.id !== folder.id && item.name.toLowerCase() === name.toLowerCase())) return setNotice("Folder đã tồn tại");
    setFolders((items) => items.map((item) => item.id === folder.id ? { ...item, name: name.slice(0, 80), updatedAt: new Date().toISOString() } : item));
  }

  function deleteFolder(folder) {
    if (!window.confirm(`Xóa folder “${folder.name}”? Prompt bên trong sẽ chuyển thành Unfiled.`)) return;
    setFolders((items) => items.filter((item) => item.id !== folder.id));
    setPrompts((items) => items.map((prompt) => prompt.folderId === folder.id ? { ...prompt, folderId: null, updatedAt: new Date().toISOString() } : prompt));
    if (activeFolderId === folder.id) setActiveFolderId(null);
  }

  function toggleTagFilter(tagId) {
    setSelectedTagIds((ids) => ids.includes(tagId) ? ids.filter((id) => id !== tagId) : [...ids, tagId]);
  }

  function addTagToPrompt(value = tagInput) {
    if (!selectedPrompt || !isEditing) return;
    const normalizedName = normalizeTagName(value);
    if (!normalizedName) return;
    const existing = tags.find((tag) => tag.normalizedName === normalizedName);
    const tag = existing || { id: newId(), name: normalizedName, normalizedName, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (!existing) setTags((items) => [...items, tag].sort((a, b) => a.normalizedName.localeCompare(b.normalizedName)));
    if (!(selectedPrompt.tagIds || []).includes(tag.id)) updatePromptDetails({ tagIds: [...(selectedPrompt.tagIds || []), tag.id] });
    setTagInput("");
  }

  function removeTagFromPrompt(tagId) {
    updatePromptDetails({ tagIds: (selectedPrompt?.tagIds || []).filter((id) => id !== tagId) });
  }

  function renameTag(tag) {
    const normalizedName = normalizeTagName(window.prompt("Đổi tên tag", tag.name));
    if (!normalizedName || normalizedName === tag.normalizedName) return;
    if (tags.some((item) => item.id !== tag.id && item.normalizedName === normalizedName)) return setNotice("Tag đã tồn tại");
    setTags((items) => items.map((item) => item.id === tag.id ? { ...item, name: normalizedName, normalizedName, updatedAt: new Date().toISOString() } : item));
  }

  function deleteTag(tag) {
    if (!window.confirm(`Xóa tag “${tag.name}” khỏi toàn bộ library?`)) return;
    setTags((items) => items.filter((item) => item.id !== tag.id));
    setPrompts((items) => items.map((prompt) => (prompt.tagIds || []).includes(tag.id) ? { ...prompt, tagIds: prompt.tagIds.filter((id) => id !== tag.id), updatedAt: new Date().toISOString() } : prompt));
    setSelectedTagIds((ids) => ids.filter((id) => id !== tag.id));
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
    if (hasEditChanges) {
      setPendingPromptId("__new__");
      return;
    }
    createPromptNow();
  }

  function createPromptNow() {
    const existingLocalDraft = prompts.find((prompt) => prompt.localOnly);
    if (existingLocalDraft) {
      setSelectedPromptId(existingLocalDraft.id);
      setTab("editor");
        editSnapshotRef.current = {
        title: existingLocalDraft.title,
        titleAuto: existingLocalDraft.titleAuto,
        description: existingLocalDraft.description,
          draftContent: existingLocalDraft.draftContent,
          folderId: existingLocalDraft.folderId,
          tagIds: existingLocalDraft.tagIds,
        updatedAt: existingLocalDraft.updatedAt,
        localOnly: existingLocalDraft.localOnly,
      };
      setIsEditing(true);
      setSidebarOpen(false);
      setNotice("Đang mở draft trống");
      return;
    }
    const id = newId();
    const prompt = {
      id,
      title: "",
      titleAuto: true,
      description: "",
      draftContent: "",
      updatedAt: new Date().toISOString(),
      versions: [],
      folderId: null,
      tagIds: [],
      localOnly: true,
    };
    setPrompts((items) => [prompt, ...items]);
    setSelectedPromptId(id);
    setTab("editor");
    editSnapshotRef.current = {
      title: prompt.title,
      titleAuto: prompt.titleAuto,
      description: prompt.description,
      draftContent: prompt.draftContent,
      folderId: prompt.folderId,
      tagIds: prompt.tagIds,
      updatedAt: prompt.updatedAt,
      localOnly: prompt.localOnly,
    };
    setIsEditing(true);
    setSidebarOpen(false);
    setNotice("Draft mới đã tạo");
  }

  function selectPrompt(id) {
    if (id === selectedPrompt?.id) {
      setSidebarOpen(false);
      return;
    }
    if (hasEditChanges) {
      setPendingPromptId(id);
      return;
    }
    setContextMenu(null);
    editSnapshotRef.current = null;
    setIsEditing(false);
    setSelectedPromptId(id);
    setSidebarOpen(false);
  }

  function beginEditing() {
    if (!selectedPrompt) return;
    editSnapshotRef.current = {
      title: selectedPrompt.title,
      titleAuto: selectedPrompt.titleAuto,
      description: selectedPrompt.description,
      draftContent: selectedPrompt.draftContent,
      folderId: selectedPrompt.folderId,
      tagIds: selectedPrompt.tagIds,
      updatedAt: selectedPrompt.updatedAt,
      localOnly: selectedPrompt.localOnly,
    };
    setIsEditing(true);
  }

  function restoreEditSnapshot() {
    if (!selectedPrompt || !editSnapshotRef.current) return;
    const snapshot = editSnapshotRef.current;
    setPrompts((items) => items.map((prompt) => prompt.id === selectedPrompt.id
      ? { ...prompt, ...snapshot }
      : prompt));
  }

  function cancelEditing() {
    if (hasEditChanges) restoreEditSnapshot();
    editSnapshotRef.current = null;
    setIsEditing(false);
    setNotice(hasEditChanges ? "Đã bỏ thay đổi" : "Đã hủy chỉnh sửa");
  }

  function confirmPromptNavigation() {
    if (!pendingPromptId) return;
    const nextPromptId = pendingPromptId;
    restoreEditSnapshot();
    editSnapshotRef.current = null;
    setIsEditing(false);
    setPendingPromptId(null);
    setContextMenu(null);
    if (nextPromptId === "__new__") {
      createPromptNow();
      return;
    }
    setSelectedPromptId(nextPromptId);
    setSidebarOpen(false);
    setNotice("Đã bỏ thay đổi");
  }

  function saveVersion() {
    if (!selectedPrompt || !canSaveVersion) return;
    const version = { id: newId(), content: selectedPrompt.draftContent, createdAt: new Date().toISOString() };
    setPrompts((items) => items.map((prompt) => prompt.id === selectedPrompt.id
      ? { ...prompt, versions: [...prompt.versions, version], updatedAt: new Date().toISOString() }
      : prompt));
    editSnapshotRef.current = null;
    setIsEditing(false);
    setNotice(`Đã lưu v${nextVersionNumber}`);
  }

  function duplicatePrompt(prompt = selectedPrompt) {
    const target = prompt;
    if (!target || target.localOnly || !target.draftContent.trim()) return;
    const copy = {
      id: newId(),
      title: `${displayTitle(target)} copy`,
      titleAuto: false,
      description: target.description,
      draftContent: target.draftContent,
      folderId: target.folderId,
      tagIds: [...(target.tagIds || [])],
      updatedAt: new Date().toISOString(),
      versions: [],
      localOnly: false,
    };
    setPrompts((items) => [copy, ...items]);
    setSelectedPromptId(copy.id);
    setTab("editor");
    editSnapshotRef.current = null;
    setIsEditing(false);
    setContextMenu(null);
    setNotice("Đã nhân bản draft");
  }

  async function copyLatestVersion(prompt) {
    const latest = prompt?.versions?.at(-1);
    setContextMenu(null);
    if (!latest) {
      setNotice("Prompt chưa có version");
      return;
    }
    if (!navigator.clipboard?.writeText) {
      setNotice("Trình duyệt không cho phép copy");
      return;
    }
    try {
      await navigator.clipboard.writeText(latest.content);
      setNotice(`Đã copy v${prompt.versions.length}`);
    } catch {
      setNotice("Không thể copy vào clipboard");
    }
  }

  function openPromptMenu(event, promptId) {
    event.preventDefault();
    event.stopPropagation();
    const point = event.currentTarget?.getBoundingClientRect
      ? event.currentTarget.getBoundingClientRect()
      : { right: event.clientX, bottom: event.clientY };
    const x = event.clientX || point.right;
    const y = event.clientY || point.bottom;
    setContextMenu({ promptId, x: Math.min(x, window.innerWidth - 220), y: Math.min(y, window.innerHeight - 170) });
  }

  function requestDeletePrompt(promptId) {
    setContextMenu((current) => current?.promptId === promptId ? { ...current, deleteConfirm: true } : current);
  }

  function cancelDeletePrompt() {
    setContextMenu((current) => current ? { ...current, deleteConfirm: false } : null);
  }

  function confirmDeletePrompt(promptId) {
    const target = prompts.find((prompt) => prompt.id === promptId);
    if (!target) return;
    const next = prompts.filter((prompt) => prompt.id !== promptId);
    setPrompts(next);
    setContextMenu(null);
    if (selectedPromptId === promptId) {
      editSnapshotRef.current = null;
      setIsEditing(false);
      setSelectedPromptId(next[0]?.id || null);
      setTab("editor");
    }
    setNotice(`Đã xóa ${displayTitle(target)}`);
  }

  function deletePrompt() {
    if (!selectedPrompt || !window.confirm(`Xóa prompt “${selectedPrompt.title || "Untitled prompt"}”? Hành động này không thể hoàn tác.`)) return;
    const next = prompts.filter((prompt) => prompt.id !== selectedPrompt.id);
    setPrompts(next);
    editSnapshotRef.current = null;
    setIsEditing(false);
    setSelectedPromptId(next[0]?.id || null);
    setNotice("Đã xóa prompt");
  }

  function exportData() {
    const payload = {
      version: 2,
      folders: folders.map((folder) => folder.name),
      tags: tags.map((tag) => tag.name),
      prompts: prompts.filter((prompt) => !prompt.localOnly).map((prompt) => ({
        ...prompt,
        folder: folderById.get(prompt.folderId)?.name || null,
        tagNames: (prompt.tagIds || []).map((tagId) => tagById.get(tagId)?.name).filter(Boolean),
        folderId: undefined,
        tagIds: undefined,
        localOnly: undefined,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
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
        const sourcePrompts = Array.isArray(parsed) ? parsed : parsed.prompts;
        if (!Array.isArray(sourcePrompts) || !sourcePrompts.length) throw new Error();
        const now = new Date().toISOString();
        const importedFolders = [...new Set([...(Array.isArray(parsed.folders) ? parsed.folders : []), ...sourcePrompts.map((prompt) => prompt.folder).filter(Boolean)])].map((name, position) => ({ id: newId(), name: String(name).trim().slice(0, 80), position, createdAt: now, updatedAt: now }));
        const importedTags = [...new Set([...(Array.isArray(parsed.tags) ? parsed.tags : []), ...sourcePrompts.flatMap((prompt) => prompt.tagNames || prompt.tags || [])].map(normalizeTagName).filter(Boolean))].map((name) => ({ id: newId(), name, normalizedName: name, createdAt: now, updatedAt: now }));
        const folderIds = new Map(importedFolders.map((folder) => [folder.name.toLowerCase(), folder.id]));
        const tagIds = new Map(importedTags.map((tag) => [tag.normalizedName, tag.id]));
        const imported = normalizePrompts(sourcePrompts).map((prompt, index) => ({
          ...prompt,
          id: newId(),
          folderId: folderIds.get(String(sourcePrompts[index].folder || "").toLowerCase()) || null,
          tagIds: (sourcePrompts[index].tagNames || sourcePrompts[index].tags || []).map(normalizeTagName).map((name) => tagIds.get(name)).filter(Boolean),
          updatedAt: new Date().toISOString(),
          versions: prompt.versions.map((version) => ({ ...version, id: newId() })),
        }));
        setFolders((items) => [...items, ...importedFolders]);
        setTags((items) => [...items, ...importedTags.filter((tag) => !items.some((item) => item.normalizedName === tag.normalizedName))]);
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
          <div className="sidebar-section">
            <div className="sidebar-section-heading"><span>Folders</span><button className="sidebar-add" onClick={createFolder} aria-label="Tạo folder"><Plus size={15} /></button></div>
            <button className={`sidebar-filter ${!activeFolderId ? "active" : ""}`} onClick={() => setActiveFolderId(null)}>Tất cả prompt <span>{prompts.length}</span></button>
            <button className={`sidebar-filter ${activeFolderId === "__unfiled__" ? "active" : ""}`} onClick={() => setActiveFolderId("__unfiled__")}>Unfiled <span>{prompts.filter((prompt) => !prompt.folderId).length}</span></button>
            {folders.map((folder) => <div className="sidebar-filter-row" key={folder.id}><button className={`sidebar-filter ${activeFolderId === folder.id ? "active" : ""}`} onClick={() => setActiveFolderId(folder.id)}>{folder.name}<span>{prompts.filter((prompt) => prompt.folderId === folder.id).length}</span></button><button className="sidebar-mini-action" onClick={() => renameFolder(folder)} aria-label={`Đổi tên ${folder.name}`}><PencilSimple size={13} /></button><button className="sidebar-mini-action danger" onClick={() => deleteFolder(folder)} aria-label={`Xóa ${folder.name}`}><Trash size={13} /></button></div>)}
          </div>
          <div className="sidebar-section">
            <div className="sidebar-section-heading"><span>Tags</span><span className="count">{tags.length}</span></div>
            {tags.map((tag) => <div className="sidebar-filter-row" key={tag.id}><button className={`sidebar-filter ${selectedTagIds.includes(tag.id) ? "active" : ""}`} onClick={() => toggleTagFilter(tag.id)}>#{tag.name}<span>{prompts.filter((prompt) => (prompt.tagIds || []).includes(tag.id)).length}</span></button><button className="sidebar-mini-action" onClick={() => renameTag(tag)} aria-label={`Đổi tên tag ${tag.name}`}><PencilSimple size={13} /></button><button className="sidebar-mini-action danger" onClick={() => deleteTag(tag)} aria-label={`Xóa tag ${tag.name}`}><Trash size={13} /></button></div>)}
          </div>
          <div className="prompt-list">
            {filtered.map((prompt) => (
              <div
                key={prompt.id}
                className={`prompt-card ${prompt.id === selectedPrompt?.id ? "active" : ""}`}
                onContextMenu={(event) => openPromptMenu(event, prompt.id)}
              >
                <button className="prompt-card-main" onClick={() => selectPrompt(prompt.id)}>
                  <div className="prompt-title"><FolderSimple size={17} weight={prompt.id === selectedPrompt?.id ? "fill" : "regular"} /><strong>{displayTitle(prompt)}</strong></div>
                  <p>{prompt.description || (prompt.localOnly ? "Draft local · Chưa có nội dung" : "Chưa có mô tả")}</p>
                  <div className="card-meta"><span>{prompt.localOnly ? "Draft local" : `${prompt.versions.length} versions`}</span><span>{formatRelativeTime(prompt.updatedAt)}</span></div>
                </button>
                <button className="prompt-menu-trigger" onClick={(event) => openPromptMenu(event, prompt.id)} aria-label={`Mở actions cho ${displayTitle(prompt)}`} title="Actions"><DotsThreeVertical size={18} /></button>
              </div>
            ))}
          </div>
          {contextMenu && (() => {
            const prompt = prompts.find((item) => item.id === contextMenu.promptId);
            if (!prompt) return null;
            return <div className="prompt-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={(event) => event.stopPropagation()} role="menu">
              <button onClick={() => copyLatestVersion(prompt)} disabled={!prompt.versions.at(-1)} role="menuitem"><Copy size={16} /> Copy latest version</button>
              <button onClick={() => duplicatePrompt(prompt)} disabled={prompt.localOnly || !prompt.draftContent.trim()} role="menuitem"><Copy size={16} /> Duplicate</button>
              {contextMenu.deleteConfirm ? <div className="prompt-context-delete" role="menuitem">
                <strong>Delete?</strong>
                <div><button className="prompt-inline-action cancel" onClick={cancelDeletePrompt} aria-label="Hủy xóa"><X size={16} /></button><button className="prompt-inline-action danger" onClick={() => confirmDeletePrompt(prompt.id)} aria-label="Xác nhận xóa"><Trash size={16} /></button></div>
              </div> : <button className="danger" onClick={() => requestDeletePrompt(prompt.id)} role="menuitem"><Trash size={16} /> Delete</button>}
            </div>;
          })()}
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
                <input className="title-input" value={selectedPrompt.title || deriveTitle(selectedPrompt.draftContent)} onChange={(e) => updatePromptDetails({ title: e.target.value })} placeholder="Untitled prompt" aria-label="Tên prompt" />
                <input className="description-input" value={selectedPrompt.description} onChange={(e) => updatePromptDetails({ description: e.target.value })} placeholder="Mô tả mục tiêu của prompt…" aria-label="Mô tả prompt" />
              </> : <>
                <h1 className="prompt-title-heading">{displayTitle(selectedPrompt)}</h1>
                <p className="prompt-description-text">{selectedPrompt.description || "Chưa có mô tả"}</p>
              </>}
              <div className="prompt-metadata">
                {isEditing ? <select className="metadata-select" value={selectedPrompt.folderId || ""} onChange={(e) => updatePromptDetails({ folderId: e.target.value || null })}><option value="">Unfiled</option>{folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}</select> : selectedPrompt.folderId && <span className="metadata-folder"><FolderSimple size={14} /> {folderById.get(selectedPrompt.folderId)?.name}</span>}
                <div className="tag-chips">{(selectedPrompt.tagIds || []).map((tagId) => { const tag = tagById.get(tagId); return tag ? <span className="tag-chip" key={tag.id}>#{tag.name}{isEditing && <button onClick={() => removeTagFromPrompt(tag.id)} aria-label={`Xóa tag ${tag.name}`}><X size={12} /></button>}</span> : null; })}{isEditing && <input className="tag-input" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTagToPrompt(); } }} placeholder="Thêm tag…" aria-label="Thêm tag" />}</div>
              </div>
            </div>
            <div className="header-actions">
              <button className="icon-button" onClick={() => duplicatePrompt(selectedPrompt)} disabled={!selectedPrompt.draftContent.trim()} title="Duplicate" aria-label="Nhân bản prompt"><Copy size={17} /></button>
              <button className="icon-button danger" onClick={deletePrompt} title="Delete" aria-label="Xóa prompt"><Trash size={17} /></button>
              {isEditing ? <><button className="button ghost edit-cancel" onClick={cancelEditing}>{hasEditChanges ? "Bỏ thay đổi" : "Hủy"}</button><button className="button primary" onClick={saveVersion} disabled={!canSaveVersion} title={!selectedPrompt.draftContent.trim() ? "Nhập nội dung trước khi lưu version" : hasEditChanges ? saveVersionLabel : "Chưa có thay đổi"}><GitBranch size={17} /> {saveVersionLabel}</button></> : <button className="button primary" onClick={beginEditing}><Key size={17} /> Chỉnh sửa</button>}
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
                {isEditing ? <MDXEditor className={`prompt-mdx-editor ${theme === "dark" ? "dark-theme" : "light-theme"}`} ref={editorRef} key={`edit-${selectedPrompt.id}`} markdown={selectedPrompt.draftContent} onChange={updateDraft} plugins={EDITOR_PLUGINS} aria-label="Markdown prompt editor" /> : <MDXEditor className={`prompt-mdx-editor ${theme === "dark" ? "dark-theme" : "light-theme"}`} ref={editorRef} key={`view-${selectedPrompt.id}`} markdown={selectedPrompt.draftContent || "_Chưa có nội dung._"} plugins={MARKDOWN_PLUGINS} readOnly aria-label="Readonly prompt preview" />}
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
      {pendingPromptId && <div className="dialog-backdrop" role="presentation">
        <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="navigation-dialog-title">
          <h2 id="navigation-dialog-title">Bỏ thay đổi?</h2>
          <p>Các chỉnh sửa chưa lưu thành version sẽ bị bỏ khi chuyển sang prompt khác.</p>
          <div className="dialog-actions"><button className="button ghost" onClick={() => setPendingPromptId(null)}>Tiếp tục sửa</button><button className="button primary" onClick={confirmPromptNavigation}>Bỏ và chuyển</button></div>
        </section>
      </div>}
    </main>
  );
}
