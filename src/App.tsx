import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import { GoogleGenAI } from "@google/genai";
import { 
  Plus, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  Play,
  Copy,
  LayoutGrid,
  FileText,
  ChevronRight,
  Loader2,
  Database,
  Cpu,
  UserCheck,
  BookOpen,
  ArrowRight,
  Search,
  MoreVertical,
  Layers,
  ShieldCheck,
  BarChart3,
  Zap,
  Keyboard,
  Filter,
  Image as ImageIcon,
  Mic,
  Upload,
  X,
  FolderPlus
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell
} from 'recharts';

interface Batch {
  id: number;
  project_id?: number;
  project_name?: string;
  name: string;
  status: string;
  taxonomy?: string; // JSON string
  assigned_to?: number;
  assignee_name?: string;
  created_at: string;
}

interface Project {
  id: number;
  name: string;
  description: string;
  deadline: string;
  status: string;
  batch_count: number;
  task_count: number;
  completed_tasks: number;
  created_at: string;
}

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
}

interface Job {
  id: number;
  company: string;
  title: string;
  url: string;
  pay: string;
  type: string;
  source: string;
}

interface AIModel {
  id: string;
  name: string;
  provider: string;
  capabilities: string[]; // 'vision', 'audio', 'reasoning'
  inputCost: number; // Cost per 1M tokens in USD
  outputCost: number; // Cost per 1M tokens in USD
}

const AVAILABLE_MODELS: AIModel[] = [
  { id: 'gemini-3-flash-preview', name: 'Gemini 3 Flash', provider: 'Google', capabilities: ['vision', 'audio', 'reasoning'], inputCost: 0.075, outputCost: 0.30 },
  { id: 'gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', provider: 'Google', capabilities: ['vision', 'audio', 'reasoning'], inputCost: 3.50, outputCost: 10.50 },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'OpenAI', capabilities: ['vision', 'reasoning'], inputCost: 5.00, outputCost: 15.00 },
  { id: 'claude-3-5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'Anthropic', capabilities: ['vision', 'reasoning'], inputCost: 3.00, outputCost: 15.00 },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1', provider: 'DeepSeek', capabilities: ['reasoning'], inputCost: 0.14, outputCost: 0.28 },
  { id: 'mistral-large', name: 'Mistral Large', provider: 'Mistral', capabilities: ['reasoning'], inputCost: 2.00, outputCost: 6.00 },
  { id: 'qwen-2.5-72b', name: 'Qwen 2.5 72B', provider: 'OpenRouter', capabilities: ['reasoning'], inputCost: 0.40, outputCost: 0.40 },
  { id: 'llama-3.1-405b', name: 'Llama 3.1 405B', provider: 'OpenRouter', capabilities: ['reasoning'], inputCost: 2.00, outputCost: 2.00 },
];

interface Task {
  id: number;
  batch_id: number;
  content: string;
  media_url?: string;
  media_type?: 'text' | 'image' | 'audio';
  ai_label?: string;
  ai_confidence?: number;
  ai_reason?: string;
  validation_status?: string;
  validation_suggestion?: string;
  human_label?: string;
  comparison_results?: string; // JSON string: { [modelId: string]: { label, confidence, reason, usage: { input, output } } }
  error_message?: string;
  input_tokens: number;
  output_tokens: number;
  status: string;
}

interface Guideline {
  id: number;
  title: string;
  content: string;
}

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export default function App() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<Batch | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [guidelines, setGuidelines] = useState<Guideline[]>([]);
  const [view, setView] = useState<"dashboard" | "batch" | "guidelines" | "projects" | "team" | "discovery">("dashboard");
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>("gemini-3-flash-preview");
  const [comparisonModels, setComparisonModels] = useState<string[]>([]);
  const [isComparisonMode, setIsComparisonMode] = useState(false);
  const [filterConfig, setFilterConfig] = useState({
    confidenceRange: [0, 1] as [number, number],
    validationStatus: 'all' as 'all' | 'correct' | 'incorrect' | 'ambiguous',
    hasHumanLabel: 'all' as 'all' | 'yes' | 'no'
  });
  const [newBatchName, setNewBatchName] = useState("");
  const [newTasksInput, setNewTasksInput] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState<number | string>("");
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<number | string>("");
  const [showNewBatchModal, setShowNewBatchModal] = useState(false);
  const [showNewGuidelineModal, setShowNewGuidelineModal] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [newGuideline, setNewGuideline] = useState({ title: "", content: "" });
  const [newProject, setNewProject] = useState({ name: "", description: "", deadline: "" });
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>([]);
  const [filterMode, setFilterMode] = useState<"all" | "priority">("all");
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [taxonomyInput, setTaxonomyInput] = useState("");
  const [showMultimodalModal, setShowMultimodalModal] = useState(false);
  const [multimodalForm, setMultimodalForm] = useState({
    content: "",
    type: "image" as "image" | "audio",
    file: null as File | null
  });

  useEffect(() => {
    fetchBatches();
    fetchGuidelines();
    fetchProjects();
    fetchUsers();
    fetchJobs();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (view !== "batch" || !activeTaskId || showNewBatchModal || showMultimodalModal) return;
      
      const currentTask = tasks.find(t => t.id === activeTaskId);
      if (!currentTask) return;

      if (e.key === " ") {
        e.preventDefault();
        if (currentTask.ai_label) verifyTask(currentTask.id, currentTask.ai_label);
      } else if (e.key === "e") {
        const label = prompt("Enter correct label:", currentTask.ai_label);
        if (label) verifyTask(currentTask.id, label);
      } else if (e.key === "j") {
        const idx = tasks.findIndex(t => t.id === activeTaskId);
        if (idx < tasks.length - 1) setActiveTaskId(tasks[idx + 1].id);
      } else if (e.key === "k") {
        const idx = tasks.findIndex(t => t.id === activeTaskId);
        if (idx > 0) setActiveTaskId(tasks[idx - 1].id);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [view, activeTaskId, tasks, showNewBatchModal, showMultimodalModal]);

  const fetchBatches = async () => {
    const res = await fetch("/api/batches");
    setBatches(await res.json());
  };

  const fetchJobs = async () => {
    const res = await fetch("/api/jobs");
    const data = await res.json();
    if (data.length === 0) {
      await fetch("/api/jobs/discover", { method: "POST" });
      const freshRes = await fetch("/api/jobs");
      setJobs(await freshRes.json());
    } else {
      setJobs(data);
    }
  };

  const fetchProjects = async () => {
    const res = await fetch("/api/projects");
    setProjects(await res.json());
  };

  const fetchUsers = async () => {
    const res = await fetch("/api/users");
    setUsers(await res.json());
  };

  const fetchGuidelines = async () => {
    const res = await fetch("/api/guidelines");
    setGuidelines(await res.json());
  };

  const fetchTasks = async (batchId: number) => {
    const res = await fetch(`/api/batches/${batchId}/tasks`);
    setTasks(await res.json());
  };

  const createBatch = async () => {
    if (!newBatchName || !newTasksInput) return;
    const taskList = newTasksInput.split("\n").filter(t => t.trim());
    const taxonomy = taxonomyInput.split(",").map(t => t.trim()).filter(t => t);
    
    const res = await fetch("/api/batches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        name: newBatchName, 
        tasks: taskList,
        taxonomy: taxonomy.length > 0 ? taxonomy : null,
        project_id: selectedProjectId || null,
        assigned_to: selectedAssigneeId || null
      }),
    });
    if (res.ok) {
      setNewBatchName("");
      setNewTasksInput("");
      setTaxonomyInput("");
      setSelectedProjectId("");
      setSelectedAssigneeId("");
      setShowNewBatchModal(false);
      fetchBatches();
      fetchProjects();
    }
  };

  const getDeadlineStatus = (deadline: string) => {
    if (!deadline) return { text: "No Deadline", color: "text-ink-secondary", isOverdue: false };
    
    const now = new Date();
    const target = new Date(deadline);
    const diff = target.getTime() - now.getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    
    if (days < 0) return { text: `Overdue by ${Math.abs(days)}d`, color: "text-danger", isOverdue: true };
    if (days === 0) return { text: "Due Today", color: "text-warning", isOverdue: false };
    if (days <= 3) return { text: `${days}d remaining`, color: "text-warning", isOverdue: false };
    return { text: `${days}d remaining`, color: "text-success", isOverdue: false };
  };

  const createProject = async () => {
    if (!newProject.name) return;
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newProject),
    });
    if (res.ok) {
      setNewProject({ name: "", description: "", deadline: "" });
      setShowNewProjectModal(false);
      fetchProjects();
    }
  };

  const assignBatch = async (batchId: number, userId: number) => {
    await fetch(`/api/batches/${batchId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigned_to: userId }),
    });
    fetchBatches();
  };

  const createMultimodalTask = async () => {
    if (!selectedBatch || !multimodalForm.file) return;
    const formData = new FormData();
    formData.append("file", multimodalForm.file);
    formData.append("content", multimodalForm.content);
    formData.append("media_type", multimodalForm.type);

    const res = await fetch(`/api/batches/${selectedBatch.id}/tasks/multimodal`, {
      method: "POST",
      body: formData,
    });
    if (res.ok) {
      setMultimodalForm({ content: "", type: "image", file: null });
      setShowMultimodalModal(false);
      fetchTasks(selectedBatch.id);
    }
  };

  const deleteBatch = async (id: number) => {
    if (!confirm("Delete this batch and all its tasks?")) return;
    await fetch(`/api/batches/${id}`, { method: "DELETE" });
    fetchBatches();
    if (selectedBatch?.id === id) {
      setSelectedBatch(null);
      setView("dashboard");
    }
  };

  const processBatchWithAI = async (batchId: number, taskIds?: number[]) => {
    setIsProcessing(true);
    const batchTasks = tasks.filter(t => {
      if (taskIds) return taskIds.includes(t.id);
      return t.status === "pending" || t.status === "error";
    });
    const activeGuidelines = guidelines.map(g => `${g.title}: ${g.content}`).join("\n");
    const taxonomy = selectedBatch?.taxonomy ? JSON.parse(selectedBatch.taxonomy) : null;
    
    const modelsToRun = (isComparisonMode && comparisonModels.length > 0) ? comparisonModels : [selectedModel];

    for (const task of batchTasks) {
      try {
        const results: { [modelId: string]: any } = task.comparison_results ? JSON.parse(task.comparison_results) : {};
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        
        for (const modelId of modelsToRun) {
          try {
            // Agent 1: Label Generator
            const parts: any[] = [
              { text: `You are a professional data annotation assistant.
              Guidelines:
              ${activeGuidelines}
              ${taxonomy ? `Allowed Labels (Taxonomy): ${taxonomy.join(", ")}` : ""}
              
              Task Content:
              ${task.content}
              
              Return JSON with fields: label, confidence (0-1), reason.` }
            ];

            if (task.media_url) {
              try {
                const mediaRes = await fetch(task.media_url);
                if (!mediaRes.ok) throw new Error(`Media fetch failed: ${mediaRes.statusText}`);
                const blob = await mediaRes.blob();
                const base64 = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader();
                  reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
                  reader.onerror = reject;
                  reader.readAsDataURL(blob);
                });
                parts.push({
                  inlineData: {
                    data: base64,
                    mimeType: task.media_type === 'image' ? 'image/png' : 'audio/mpeg'
                  }
                });
              } catch (mediaErr: any) {
                console.warn("Media processing failed, continuing with text only:", mediaErr);
              }
            }

            const labelResponse = await ai.models.generateContent({
              model: modelId as any,
              contents: { parts },
              config: { responseMimeType: "application/json" }
            });
            
            const labelData = JSON.parse(labelResponse.text || "{}");
            const usage = labelResponse.usageMetadata;
            
            results[modelId] = { 
              ...labelData, 
              usage: { 
                input: usage?.promptTokenCount || 0, 
                output: usage?.candidatesTokenCount || 0 
              } 
            };
            
            totalInputTokens += usage?.promptTokenCount || 0;
            totalOutputTokens += usage?.candidatesTokenCount || 0;
          } catch (modelError: any) {
            console.error(`Error processing model ${modelId}:`, modelError);
            results[modelId] = { error: modelError.message || "Unknown model error" };
          }
        }

        // Use the primary selected model for the main fields if not in comparison mode, 
        // or just the first successful one.
        const primaryResult = results[selectedModel] || Object.values(results).find(r => !r.error) || Object.values(results)[0];

        // Agent 2: Reasoning Validator (always use Gemini 3 Flash for speed/cost)
        let validationData = { status: 'ambiguous', suggestion: '', explanation: 'Validation skipped' };
        if (primaryResult && !primaryResult.error) {
          try {
            const validationResponse = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: `You are a quality control reviewer for AI training data.
              Guidelines:
              ${activeGuidelines}
              
              Task: ${task.content}
              Proposed Label: ${primaryResult.label}
              Proposed Reason: ${primaryResult.reason}
              
              Verify if the label is correct and follows all guidelines. Return JSON with fields: status ('correct', 'incorrect', 'ambiguous'), suggestion (if incorrect), explanation.`,
              config: { responseMimeType: "application/json" }
            });
            validationData = JSON.parse(validationResponse.text || "{}");
            const vUsage = validationResponse.usageMetadata;
            totalInputTokens += vUsage?.promptTokenCount || 0;
            totalOutputTokens += vUsage?.candidatesTokenCount || 0;
          } catch (vError) {
            console.error("Validation Error:", vError);
          }
        }

        await fetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ai_label: primaryResult?.label,
            ai_confidence: primaryResult?.confidence,
            ai_reason: primaryResult?.reason,
            validation_status: validationData.status,
            validation_suggestion: validationData.suggestion,
            comparison_results: JSON.stringify(results),
            input_tokens: totalInputTokens,
            output_tokens: totalOutputTokens,
            status: primaryResult?.error ? "error" : "ai_processed",
            error_message: primaryResult?.error || null
          }),
        });
      } catch (error: any) {
        console.error("Task-level AI Processing Error:", error);
        try {
          await fetch(`/api/tasks/${task.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              status: "error",
              error_message: error.message || "Unknown task error"
            }),
          });
        } catch (patchError) {
          console.error("Failed to report task error to server:", patchError);
        }
      }
    }
    fetchTasks(batchId);
    setSelectedTaskIds([]);
    setIsProcessing(false);
  };

  const autosaveTask = useCallback(async (taskId: number, humanLabel: string) => {
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ human_label: humanLabel }),
      });
    } catch (error) {
      console.error("Autosave Error:", error);
    }
  }, []);

  const handleMarkdownUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      const title = file.name.replace('.md', '');
      
      await fetch("/api/guidelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      });
      fetchGuidelines();
    };
    reader.readAsText(file);
  };

  const calculateModelMetrics = (modelId: string) => {
    const verifiedTasks = tasks.filter(t => t.status === 'verified' && t.human_label);
    if (verifiedTasks.length === 0) return null;

    let correct = 0;
    let tp = 0, fp = 0, fn = 0;
    
    verifiedTasks.forEach(task => {
      const results = task.comparison_results ? JSON.parse(task.comparison_results) : {};
      const modelResult = results[modelId];
      if (!modelResult || modelResult.error) return;

      if (modelResult.label === task.human_label) {
        correct++;
        tp++; 
      } else {
        fp++;
        fn++;
      }
    });

    const accuracy = correct / verifiedTasks.length;
    const precision = tp / (tp + fp) || 0;
    const recall = tp / (tp + fn) || 0;
    const f1 = (2 * precision * recall) / (precision + recall) || 0;

    let totalModelCost = 0;
    tasks.forEach(task => {
      const results = task.comparison_results ? JSON.parse(task.comparison_results) : {};
      const modelResult = results[modelId];
      if (modelResult && modelResult.usage) {
        const model = AVAILABLE_MODELS.find(m => m.id === modelId);
        if (model) {
          totalModelCost += ((modelResult.usage.input || 0) / 1000000) * model.inputCost;
          totalModelCost += ((modelResult.usage.output || 0) / 1000000) * model.outputCost;
        }
      }
    });

    return { accuracy, precision, recall, f1, count: verifiedTasks.length, cost: totalModelCost };
  };

  const calculateBatchCost = () => {
    let totalCost = 0;
    tasks.forEach(task => {
      if (task.comparison_results) {
        const results = JSON.parse(task.comparison_results);
        Object.keys(results).forEach(modelId => {
          const model = AVAILABLE_MODELS.find(m => m.id === modelId);
          const usage = results[modelId].usage;
          if (model && usage) {
            totalCost += ((usage.input || 0) / 1000000) * model.inputCost;
            totalCost += ((usage.output || 0) / 1000000) * model.outputCost;
          }
        });
        
        // Add validation cost (Gemini 3 Flash)
        // Estimate validation tokens if not explicitly stored per model
        // In our implementation, totalInputTokens includes validation
        const totalModelInput = Object.values(results).reduce((acc: number, r: any) => acc + (Number(r.usage?.input) || 0), 0) as number;
        const totalModelOutput = Object.values(results).reduce((acc: number, r: any) => acc + (Number(r.usage?.output) || 0), 0) as number;
        
        const vInput = Math.max(0, (Number(task.input_tokens) || 0) - totalModelInput) as number;
        const vOutput = Math.max(0, (Number(task.output_tokens) || 0) - totalModelOutput) as number;
        
        const flash = AVAILABLE_MODELS.find(m => m.id === 'gemini-3-flash-preview');
        if (flash) {
          totalCost += (vInput / 1000000) * flash.inputCost;
          totalCost += (vOutput / 1000000) * flash.outputCost;
        }
      }
    });
    return totalCost;
  };

  const verifyTask = async (taskId: number, label: string) => {
    await fetch(`/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ human_label: label, status: "verified" }),
    });
    if (selectedBatch) fetchTasks(selectedBatch.id);
  };

  const bulkVerify = async () => {
    if (!selectedBatch || selectedTaskIds.length === 0) return;
    setIsProcessing(true);
    for (const id of selectedTaskIds) {
      const task = tasks.find(t => t.id === id);
      if (task && task.ai_label) {
        await fetch(`/api/tasks/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ human_label: task.ai_label, status: "verified" }),
        });
      }
    }
    fetchTasks(selectedBatch.id);
    setSelectedTaskIds([]);
    setIsProcessing(false);
  };

  const copyResults = () => {
    const results = tasks.map(t => `${t.content}\t${t.human_label || t.ai_label}`).join("\n");
    navigator.clipboard.writeText(results);
    alert("Results copied to clipboard!");
  };

  return (
    <div className="min-h-screen bg-bg-warm text-ink-primary font-sans">
      {/* Top Navigation */}
      <nav className="h-16 bg-white border-b border-border-neutral sticky top-0 z-50 px-8 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-ink-primary rounded flex items-center justify-center">
              <Database className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-lg font-serif font-bold tracking-tight">Axiom</h1>
          </div>
          
          <div className="hidden md:flex items-center gap-1">
            <button 
              onClick={() => setView("dashboard")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                view === "dashboard" ? "bg-bg-warm text-ink-primary" : "text-ink-secondary hover:text-ink-primary"
              }`}
            >
              Dashboard
            </button>
            <button 
              onClick={() => setView("projects")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                view === "projects" ? "bg-bg-warm text-ink-primary" : "text-ink-secondary hover:text-ink-primary"
              }`}
            >
              Projects
            </button>
            <button 
              onClick={() => setView("team")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                view === "team" ? "bg-bg-warm text-ink-primary" : "text-ink-secondary hover:text-ink-primary"
              }`}
            >
              Team
            </button>
            <button 
              onClick={() => setView("discovery")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                view === "discovery" ? "bg-bg-warm text-ink-primary" : "text-ink-secondary hover:text-ink-primary"
              }`}
            >
              Discovery
            </button>
            <button 
              onClick={() => setView("guidelines")}
              className={`px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                view === "guidelines" ? "bg-bg-warm text-ink-primary" : "text-ink-secondary hover:text-ink-primary"
              }`}
            >
              Guidelines
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="relative hidden sm:block">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-secondary" />
            <input 
              type="text" 
              placeholder="Search tasks..."
              className="pl-9 pr-4 py-1.5 bg-bg-warm border border-border-neutral rounded-md text-sm outline-none focus:border-ink-primary/20 transition-colors w-64"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="w-8 h-8 rounded-full bg-border-neutral flex items-center justify-center">
            <UserCheck className="w-4 h-4 text-ink-secondary" />
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-8 py-12">
        {/* Bulk Actions Floating Bar */}
        <AnimatePresence>
          {selectedTaskIds.length > 0 && (
            <motion.div 
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-ink-primary text-white px-8 py-4 rounded-2xl shadow-2xl flex items-center gap-8 border border-white/10 backdrop-blur-md"
            >
              <div className="flex items-center gap-3 pr-8 border-r border-white/20">
                <span className="text-xs font-bold uppercase tracking-widest text-white/60">Selected</span>
                <span className="text-2xl font-serif font-bold">{selectedTaskIds.length}</span>
              </div>
              
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => processBatchWithAI(selectedBatch?.id || 0, selectedTaskIds)}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-4 py-2 bg-success text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-success/90 transition-all disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  Process Batch
                </button>
                
                <button 
                  onClick={bulkVerify}
                  disabled={isProcessing}
                  className="flex items-center gap-2 px-4 py-2 bg-white/10 text-white rounded-lg text-xs font-bold uppercase tracking-widest hover:bg-white/20 transition-all disabled:opacity-50"
                >
                  <ShieldCheck className="w-3 h-3" />
                  Approve All
                </button>

                <button 
                  onClick={() => setSelectedTaskIds([])}
                  className="text-xs font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors"
                >
                  Clear
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {view === "dashboard" && (
          <div className="space-y-12">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-[0.2em]">Workstation Overview</p>
                <h2 className="text-4xl font-serif text-ink-primary">Intelligence Dashboard</h2>
              </div>
              <div className="flex gap-3">
                <button 
                  onClick={() => setShowNewProjectModal(true)}
                  className="bg-white border border-border-neutral text-ink-primary px-6 py-2.5 rounded-md text-sm font-medium hover:bg-bg-warm transition-all flex items-center gap-2 shadow-sm"
                >
                  <FolderPlus className="w-4 h-4" />
                  New Project
                </button>
                <button 
                  onClick={() => setShowNewBatchModal(true)}
                  className="bg-ink-primary text-white px-6 py-2.5 rounded-md text-sm font-medium hover:bg-ink-primary/90 transition-all flex items-center gap-2 shadow-sm"
                >
                  <Plus className="w-4 h-4" />
                  Initialize New Batch
                </button>
              </div>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {batches.map(batch => (
                <motion.div 
                  key={batch.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="group bg-white border border-border-neutral rounded-xl p-8 card-shadow hover:border-ink-primary/10 transition-all cursor-pointer flex flex-col h-full"
                  onClick={() => {
                    setSelectedBatch(batch);
                    fetchTasks(batch.id);
                    setView("batch");
                  }}
                >
                  <div className="flex justify-between items-start mb-6">
                    <div className="w-12 h-12 bg-bg-warm rounded-lg flex items-center justify-center group-hover:bg-ink-primary group-hover:text-white transition-all duration-300">
                      <Layers className="w-6 h-6" />
                    </div>
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-bg-warm text-ink-secondary uppercase tracking-wider">
                      {batch.status}
                    </span>
                  </div>
                  
                  <h3 className="text-xl font-serif font-bold text-ink-primary mb-2 group-hover:text-ink-primary transition-colors">{batch.name}</h3>
                  <p className="text-xs text-ink-secondary mb-2">Project: {batch.project_name || 'Unassigned'}</p>
                  <p className="text-xs text-ink-secondary mb-4">Assignee: {batch.assignee_name || 'Unassigned'}</p>
                  <p className="text-sm text-ink-secondary mb-8 line-clamp-2">Batch initialized on {new Date(batch.created_at).toLocaleDateString()}. Persistent labeling session active.</p>
                  
                  <div className="mt-auto pt-6 border-t border-border-neutral flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-ink-secondary" />
                      <span className="text-xs font-medium text-ink-secondary">Analysis Active</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs font-bold text-ink-primary group-hover:translate-x-1 transition-transform">
                      Open Session <ArrowRight className="w-3 h-3" />
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {view === "projects" && (
          <div className="space-y-12">
            <header className="flex flex-col md:flex-row md:items-end justify-between gap-6">
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-[0.2em]">Project Management</p>
                <h2 className="text-4xl font-serif text-ink-primary">Active Projects</h2>
              </div>
              <button 
                onClick={() => setShowNewProjectModal(true)}
                className="bg-ink-primary text-white px-6 py-2.5 rounded-md text-sm font-medium hover:bg-ink-primary/90 transition-all flex items-center gap-2 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                New Project
              </button>
            </header>

            <div className="grid grid-cols-1 gap-6">
              {projects.map(project => (
                <div key={project.id} className="bg-white border border-border-neutral rounded-xl p-8 card-shadow">
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h3 className="text-2xl font-serif font-bold text-ink-primary mb-2">{project.name}</h3>
                      <p className="text-sm text-ink-secondary">{project.description}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-1">Deadline</p>
                      <div className="flex flex-col items-end">
                        <div className={`flex items-center gap-1.5 text-sm font-bold ${getDeadlineStatus(project.deadline).color}`}>
                          <Clock className="w-3.5 h-3.5" />
                          {getDeadlineStatus(project.deadline).text}
                        </div>
                        {project.deadline && (
                          <p className="text-[10px] text-ink-secondary font-medium">
                            {new Date(project.deadline).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-end">
                      <div className="flex gap-4">
                        <div className="text-center">
                          <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Batches</p>
                          <p className="text-lg font-bold">{project.batch_count}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Tasks</p>
                          <p className="text-lg font-bold">{project.task_count}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-1">Progress</p>
                        <p className="text-sm font-bold">{Math.round((project.completed_tasks / (project.task_count || 1)) * 100)}%</p>
                      </div>
                    </div>
                    <div className="w-full h-2 bg-bg-warm rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-success transition-all duration-1000" 
                        style={{ width: `${(project.completed_tasks / (project.task_count || 1)) * 100}%` }} 
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === "team" && (
          <div className="space-y-12">
            <header className="space-y-2">
              <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-[0.2em]">Team Management</p>
              <h2 className="text-4xl font-serif text-ink-primary">Annotators</h2>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
              {users.map(user => (
                <div key={user.id} className="bg-white border border-border-neutral rounded-xl p-8 card-shadow">
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 bg-bg-warm rounded-full flex items-center justify-center">
                      <UserCheck className="w-6 h-6 text-ink-secondary" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-ink-primary">{user.name}</h3>
                      <p className="text-xs text-ink-secondary uppercase tracking-widest font-bold">{user.role}</p>
                    </div>
                  </div>
                  <p className="text-sm text-ink-secondary mb-4">{user.email}</p>
                  <div className="pt-4 border-t border-border-neutral">
                    <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-2">Active Assignments</p>
                    <div className="space-y-2">
                      {batches.filter(b => b.assigned_to === user.id).map(b => (
                        <div key={b.id} className="text-xs font-medium bg-bg-warm px-3 py-1.5 rounded-md flex justify-between">
                          <span>{b.name}</span>
                          <span className="text-ink-secondary">{b.status}</span>
                        </div>
                      ))}
                      {batches.filter(b => b.assigned_to === user.id).length === 0 && (
                        <p className="text-xs text-ink-secondary italic">No active assignments</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === "discovery" && (
          <div className="space-y-12">
            <header className="space-y-2">
              <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-[0.2em]">Job Discovery Engine</p>
              <h2 className="text-4xl font-serif text-ink-primary">Premium Labeling Opportunities</h2>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {jobs.map(job => (
                <div key={job.id} className="bg-white border border-border-neutral rounded-xl p-8 card-shadow flex flex-col">
                  <div className="flex justify-between items-start mb-6">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold ${
                        job.company.includes('DataAnnotation') ? 'bg-indigo-600' :
                        job.company.includes('Outlier') ? 'bg-emerald-600' :
                        job.company.includes('Appen') ? 'bg-amber-600' : 'bg-slate-600'
                      }`}>
                        {job.company[0]}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-ink-primary">{job.company}</h3>
                        <p className="text-xs text-ink-secondary uppercase tracking-widest font-bold">{job.source}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full bg-bg-warm text-ink-secondary uppercase tracking-wider">
                      {job.type}
                    </span>
                  </div>
                  
                  <h4 className="text-xl font-serif font-bold text-ink-primary mb-2">{job.title}</h4>
                  <p className="text-sm text-ink-secondary mb-8">High-consistency work provider. Preferred platform for {job.type} tasks.</p>
                  
                  <div className="mt-auto pt-6 border-t border-border-neutral flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="w-4 h-4 text-ink-secondary" />
                      <span className="text-xs font-medium text-ink-secondary">{job.pay}</span>
                    </div>
                    <a 
                      href={job.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs font-bold text-ink-primary hover:translate-x-1 transition-transform"
                    >
                      Apply Now <ArrowRight className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {view === "batch" && selectedBatch && (
          <div className="space-y-10">
            <header className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <div className="space-y-2">
                <button 
                  onClick={() => setView("dashboard")}
                  className="text-[10px] font-bold text-ink-secondary uppercase tracking-[0.2em] hover:text-ink-primary transition-colors flex items-center gap-1"
                >
                  <ChevronRight className="w-3 h-3 rotate-180" /> Back to Dashboard
                </button>
                <h2 className="text-4xl font-serif text-ink-primary">{selectedBatch.name}</h2>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Primary Model</label>
                  <select 
                    value={selectedModel}
                    onChange={e => setSelectedModel(e.target.value)}
                    className="bg-white border border-border-neutral text-ink-primary px-4 py-2 rounded-md text-xs font-bold outline-none focus:border-ink-primary/20 transition-colors"
                  >
                    {AVAILABLE_MODELS.map(m => (
                      <option key={m.id} value={m.id}>{m.name} ({m.provider})</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Comparison Mode</label>
                  <div className="flex items-center gap-2 bg-white border border-border-neutral px-4 py-2 rounded-md">
                    <input 
                      type="checkbox" 
                      checked={isComparisonMode}
                      onChange={e => setIsComparisonMode(e.target.checked)}
                      className="w-4 h-4 rounded border-border-neutral text-ink-primary focus:ring-ink-primary cursor-pointer"
                    />
                    <span className="text-xs font-bold text-ink-primary">Multi-Model</span>
                  </div>
                </div>

                {isComparisonMode && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Select Models</label>
                    <div className="flex gap-1">
                      {AVAILABLE_MODELS.slice(0, 4).map(m => (
                        <button
                          key={m.id}
                          onClick={() => {
                            setComparisonModels(prev => 
                              prev.includes(m.id) ? prev.filter(id => id !== m.id) : [...prev, m.id]
                            );
                          }}
                          className={`px-2 py-1 rounded text-[10px] font-bold border transition-all ${
                            comparisonModels.includes(m.id) 
                              ? 'bg-ink-primary text-white border-ink-primary' 
                              : 'bg-white text-ink-secondary border-border-neutral hover:border-ink-secondary'
                          }`}
                        >
                          {m.name.split(' ')[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                
                <button 
                  onClick={() => setShowMultimodalModal(true)}
                  className="bg-white border border-border-neutral text-ink-primary px-6 py-2.5 rounded-md text-sm font-medium hover:bg-bg-warm transition-all flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Multimodal Task
                </button>
                <button 
                  onClick={() => processBatchWithAI(selectedBatch.id, selectedTaskIds)}
                  disabled={isProcessing || selectedTaskIds.length === 0}
                  className="bg-success text-white px-6 py-2.5 rounded-md text-sm font-medium hover:bg-success/90 disabled:bg-border-neutral disabled:text-ink-secondary transition-all flex items-center gap-2 shadow-sm"
                >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
                  Process Batch ({selectedTaskIds.length})
                </button>
                <button 
                  onClick={() => processBatchWithAI(selectedBatch.id)}
                  disabled={isProcessing || tasks.filter(t => t.status === 'pending').length === 0}
                  className="bg-ink-primary text-white px-6 py-2.5 rounded-md text-sm font-medium hover:bg-ink-primary/90 disabled:bg-border-neutral disabled:text-ink-secondary transition-all flex items-center gap-2 shadow-sm"
                >
                  {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Run Multi-Agent Engine
                </button>
                <button 
                  onClick={copyResults}
                  className="bg-white border border-border-neutral text-ink-primary px-6 py-2.5 rounded-md text-sm font-medium hover:bg-bg-warm transition-all flex items-center gap-2"
                >
                  <Copy className="w-4 h-4" />
                  Export Results
                </button>
                <button 
                  onClick={() => deleteBatch(selectedBatch.id)}
                  className="p-2.5 text-danger hover:bg-danger/5 rounded-md transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>
            </header>

            {/* Metrics Bar */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-6">
              {[
                { label: "Total Tasks", value: tasks.length, color: "bg-ink-primary" },
                { label: "Pending", value: tasks.filter(t => t.status === 'pending').length, color: "bg-ink-secondary" },
                { label: "AI Processed", value: tasks.filter(t => t.status === 'ai_processed').length, color: "bg-warning" },
                { label: "Verified", value: tasks.filter(t => t.status === 'verified').length, color: "bg-success" },
                { label: "Est. Cost", value: `$${calculateBatchCost().toFixed(4)}`, color: "bg-danger" }
              ].map((stat, i) => (
                <div key={i} className="bg-white border border-border-neutral rounded-xl p-6 card-shadow">
                  <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-4">{stat.label}</p>
                  <div className="flex items-end justify-between">
                    <span className="text-2xl font-serif font-bold text-ink-primary">{stat.value}</span>
                    {typeof stat.value === 'number' && (
                      <div className="w-12 h-1 bg-bg-warm rounded-full overflow-hidden">
                        <div 
                          className={`h-full ${stat.color} transition-all duration-1000`} 
                          style={{ width: `${(stat.value / (tasks.length || 1)) * 100}%` }} 
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Analytics Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="bg-white border border-border-neutral rounded-xl p-8 card-shadow">
                <h3 className="text-sm font-bold text-ink-secondary uppercase tracking-widest mb-8">Confidence Distribution</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[
                      { range: '0-20%', count: tasks.filter(t => (t.ai_confidence || 0) <= 0.2).length },
                      { range: '20-40%', count: tasks.filter(t => (t.ai_confidence || 0) > 0.2 && (t.ai_confidence || 0) <= 0.4).length },
                      { range: '40-60%', count: tasks.filter(t => (t.ai_confidence || 0) > 0.4 && (t.ai_confidence || 0) <= 0.6).length },
                      { range: '60-80%', count: tasks.filter(t => (t.ai_confidence || 0) > 0.6 && (t.ai_confidence || 0) <= 0.8).length },
                      { range: '80-100%', count: tasks.filter(t => (t.ai_confidence || 0) > 0.8).length },
                    ]}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E5E5" />
                      <XAxis dataKey="range" fontSize={10} axisLine={false} tickLine={false} />
                      <YAxis fontSize={10} axisLine={false} tickLine={false} />
                      <Tooltip 
                        contentStyle={{ backgroundColor: '#FFF', border: '1px solid #E5E5E5', borderRadius: '8px', fontSize: '12px' }}
                      />
                      <Bar dataKey="count" fill="#1A1A1A" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="bg-white border border-border-neutral rounded-xl p-8 card-shadow">
                <h3 className="text-sm font-bold text-ink-secondary uppercase tracking-widest mb-8">Label Agreement</h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={[
                          { name: 'Correct', value: tasks.filter(t => t.validation_status === 'correct').length },
                          { name: 'Incorrect', value: tasks.filter(t => t.validation_status === 'incorrect').length },
                          { name: 'Ambiguous', value: tasks.filter(t => t.validation_status === 'ambiguous').length },
                        ]}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                      >
                        <Cell fill="#3BB273" />
                        <Cell fill="#E5484D" />
                        <Cell fill="#E3A008" />
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Model Performance Comparison */}
            <div className="bg-white border border-border-neutral rounded-xl p-8 card-shadow">
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-sm font-bold text-ink-secondary uppercase tracking-widest">Model Performance Comparison</h3>
                <p className="text-[10px] font-bold text-ink-secondary uppercase">Based on {tasks.filter(t => t.status === 'verified').length} verified tasks</p>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-border-neutral">
                      <th className="pb-4 text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Model</th>
                      <th className="pb-4 text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Accuracy</th>
                      <th className="pb-4 text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Precision</th>
                      <th className="pb-4 text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Recall</th>
                      <th className="pb-4 text-[10px] font-bold text-ink-secondary uppercase tracking-widest">F1-Score</th>
                      <th className="pb-4 text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Total Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-neutral">
                    {AVAILABLE_MODELS.map(model => {
                      const stats = calculateModelMetrics(model.id);
                      if (!stats) return null;
                      return (
                        <tr key={model.id} className="group hover:bg-bg-warm/30 transition-colors">
                          <td className="py-4">
                            <div className="flex flex-col">
                              <span className="text-sm font-bold text-ink-primary">{model.name}</span>
                              <span className="text-[10px] text-ink-secondary uppercase">{model.provider}</span>
                            </div>
                          </td>
                          <td className="py-4">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-mono font-bold">{(stats.accuracy * 100).toFixed(1)}%</span>
                              <div className="w-12 h-1 bg-bg-warm rounded-full overflow-hidden">
                                <div className="h-full bg-ink-primary" style={{ width: `${stats.accuracy * 100}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="py-4 text-sm font-mono">{(stats.precision * 100).toFixed(1)}%</td>
                          <td className="py-4 text-sm font-mono">{(stats.recall * 100).toFixed(1)}%</td>
                          <td className="py-4">
                            <span className={`px-2 py-1 rounded text-xs font-bold font-mono ${
                              stats.f1 > 0.8 ? 'bg-success/10 text-success' : 
                              stats.f1 > 0.6 ? 'bg-warning/10 text-warning' : 'bg-danger/10 text-danger'
                            }`}>
                              {stats.f1.toFixed(3)}
                            </span>
                          </td>
                          <td className="py-4 text-sm font-mono font-bold text-ink-primary">
                            ${stats.cost.toFixed(4)}
                          </td>
                        </tr>
                      );
                    })}
                    {AVAILABLE_MODELS.every(m => !calculateModelMetrics(m.id)) && (
                      <tr>
                        <td colSpan={5} className="py-12 text-center text-xs text-ink-secondary italic">
                          Verify some tasks to see model performance metrics
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Advanced Filters */}
            <div className="bg-white border border-border-neutral rounded-xl p-6 card-shadow space-y-6">
              <div className="flex flex-wrap items-center gap-8">
                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Confidence Range</label>
                  <div className="flex items-center gap-4">
                    <input 
                      type="range" min="0" max="1" step="0.1" 
                      value={filterConfig.confidenceRange[0]}
                      onChange={e => setFilterConfig(prev => ({ ...prev, confidenceRange: [parseFloat(e.target.value), prev.confidenceRange[1]] }))}
                      className="w-24 accent-ink-primary"
                    />
                    <span className="text-xs font-bold text-ink-primary">{Math.round(filterConfig.confidenceRange[0] * 100)}% - {Math.round(filterConfig.confidenceRange[1] * 100)}%</span>
                    <input 
                      type="range" min="0" max="1" step="0.1" 
                      value={filterConfig.confidenceRange[1]}
                      onChange={e => setFilterConfig(prev => ({ ...prev, confidenceRange: [prev.confidenceRange[0], parseFloat(e.target.value)] }))}
                      className="w-24 accent-ink-primary"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Validation Status</label>
                  <div className="flex gap-2">
                    {['all', 'correct', 'incorrect', 'ambiguous'].map(status => (
                      <button
                        key={status}
                        onClick={() => setFilterConfig(prev => ({ ...prev, validationStatus: status as any }))}
                        className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
                          filterConfig.validationStatus === status 
                            ? 'bg-ink-primary text-white border-ink-primary' 
                            : 'bg-white text-ink-secondary border-border-neutral hover:border-ink-secondary'
                        }`}
                      >
                        {status}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Human Label</label>
                  <div className="flex gap-2">
                    {['all', 'yes', 'no'].map(opt => (
                      <button
                        key={opt}
                        onClick={() => setFilterConfig(prev => ({ ...prev, hasHumanLabel: opt as any }))}
                        className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest border transition-all ${
                          filterConfig.hasHumanLabel === opt 
                            ? 'bg-ink-primary text-white border-ink-primary' 
                            : 'bg-white text-ink-secondary border-border-neutral hover:border-ink-secondary'
                        }`}
                      >
                        {opt === 'all' ? 'Any' : opt === 'yes' ? 'Labeled' : 'Unlabeled'}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Filter & Priority Controls */}
            <div className="flex items-center justify-between border-b border-border-neutral pb-4">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-3 pr-4 border-r border-border-neutral">
                  <input 
                    type="checkbox" 
                    checked={selectedTaskIds.length === tasks.length && tasks.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedTaskIds(tasks.map(t => t.id));
                      } else {
                        setSelectedTaskIds([]);
                      }
                    }}
                    className="w-4 h-4 rounded border-border-neutral text-ink-primary focus:ring-ink-primary cursor-pointer"
                  />
                  <span className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Select All</span>
                </div>
                <button 
                  onClick={() => setFilterMode("all")}
                  className={`px-4 py-1.5 text-xs font-bold uppercase tracking-widest rounded-full transition-all ${
                    filterMode === "all" ? "bg-ink-primary text-white" : "text-ink-secondary hover:bg-bg-warm"
                  }`}
                >
                  All Tasks
                </button>
                <button 
                  onClick={() => setFilterMode("priority")}
                  className={`px-4 py-1.5 text-xs font-bold uppercase tracking-widest rounded-full transition-all flex items-center gap-2 ${
                    filterMode === "priority" ? "bg-danger text-white" : "text-ink-secondary hover:bg-bg-warm"
                  }`}
                >
                  <AlertCircle className="w-3 h-3" />
                  Priority Queue
                </button>
              </div>
              <div className="flex items-center gap-2 text-[10px] font-bold text-ink-secondary uppercase tracking-widest">
                <Keyboard className="w-3 h-3" /> Shortcuts Active: [Space] Approve, [E] Edit, [J/K] Navigate
              </div>
            </div>

            <div className="space-y-6">
              {tasks
                .filter(t => {
                  if (filterMode === "priority") {
                    return t.validation_status === 'incorrect' || (t.ai_confidence || 0) < 0.7;
                  }
                  
                  // Advanced Filters
                  const conf = t.ai_confidence || 0;
                  if (conf < filterConfig.confidenceRange[0] || conf > filterConfig.confidenceRange[1]) return false;
                  if (filterConfig.validationStatus !== 'all' && t.validation_status !== filterConfig.validationStatus) return false;
                  if (filterConfig.hasHumanLabel === 'yes' && !t.human_label) return false;
                  if (filterConfig.hasHumanLabel === 'no' && t.human_label) return false;

                  return true;
                })
                .map(task => (
                <motion.div 
                  key={task.id}
                  layout
                  onClick={() => setActiveTaskId(task.id)}
                  className={`bg-white border rounded-xl overflow-hidden card-shadow transition-all cursor-pointer relative ${
                    activeTaskId === task.id ? 'ring-2 ring-ink-primary border-transparent' : 'border-border-neutral'
                  } ${
                    task.status === 'verified' ? 'opacity-60 grayscale-[0.5]' : ''
                  }`}
                >
                  <div className="absolute top-8 left-8 z-10">
                    <input 
                      type="checkbox" 
                      checked={selectedTaskIds.includes(task.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTaskIds(prev => [...prev, task.id]);
                        } else {
                          setSelectedTaskIds(prev => prev.filter(id => id !== task.id));
                        }
                      }}
                      className="w-5 h-5 rounded border-border-neutral text-ink-primary focus:ring-ink-primary cursor-pointer"
                    />
                  </div>
                  <div className="p-8 pl-20 grid grid-cols-1 lg:grid-cols-12 gap-12">
                    <div className="lg:col-span-5 space-y-6">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Source Data</span>
                        {task.status === 'verified' && <ShieldCheck className="w-3.5 h-3.5 text-success" />}
                      </div>
                      <div className="bg-bg-warm/50 border border-border-neutral p-6 rounded-lg space-y-4">
                        {task.media_url && (
                          <div className="rounded-lg overflow-hidden border border-border-neutral bg-white">
                            {task.media_type === 'image' ? (
                              <img src={task.media_url} alt="Task Media" className="w-full h-auto max-h-64 object-contain" referrerPolicy="no-referrer" />
                            ) : (
                              <audio controls src={task.media_url} className="w-full p-2" />
                            )}
                          </div>
                        )}
                        <p className="text-sm text-ink-primary leading-relaxed font-medium">
                          {task.content}
                        </p>
                      </div>
                    </div>

                    <div className="lg:col-span-7 space-y-6">
                      {task.status === 'error' && (
                        <div className="p-4 bg-danger/10 border border-danger/20 rounded-lg flex items-center gap-3">
                          <AlertCircle className="w-5 h-5 text-danger" />
                          <div>
                            <p className="text-xs font-bold text-danger uppercase">Processing Error</p>
                            <p className="text-xs text-ink-primary">{task.error_message}</p>
                          </div>
                        </div>
                      )}

                      {task.status === 'pending' ? (
                        <div className="h-full flex flex-col items-center justify-center text-center py-12 border-2 border-dashed border-border-neutral rounded-lg">
                          <Cpu className="w-8 h-8 text-ink-secondary/30 mb-3" />
                          <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Awaiting Intelligence Pass</p>
                        </div>
                      ) : (
                        <div className="space-y-8">
                          {/* Side-by-Side Comparison */}
                          {task.comparison_results && (
                            <div className="space-y-4">
                              <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Model Comparison</p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {Object.entries(JSON.parse(task.comparison_results)).map(([modelId, result]: [string, any]) => (
                                  <div key={modelId} className={`p-4 rounded-lg border ${modelId === selectedModel ? 'border-ink-primary bg-bg-warm' : 'border-border-neutral bg-white'}`}>
                                    <div className="flex justify-between items-center mb-2">
                                      <span className="text-[10px] font-bold text-ink-secondary uppercase">{AVAILABLE_MODELS.find(m => m.id === modelId)?.name || modelId}</span>
                                      {result.confidence && (
                                        <span className="text-[10px] font-bold text-ink-primary">{Math.round(result.confidence * 100)}%</span>
                                      )}
                                    </div>
                                    {result.error ? (
                                      <p className="text-[10px] text-danger italic">Error: {result.error}</p>
                                    ) : (
                                      <>
                                        <p className="text-xs font-bold text-ink-primary mb-1">{result.label}</p>
                                        <p className="text-[10px] text-ink-secondary line-clamp-2 italic">"{result.reason}"</p>
                                      </>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <span className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Primary Intelligence Pass</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-tighter ${
                                (task.ai_confidence || 0) > 0.9 ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'
                              }`}>
                                {Math.round((task.ai_confidence || 0) * 100)}% Confidence
                              </span>
                            </div>
                            <div className="flex items-center gap-2">
                              {task.validation_status === 'correct' ? (
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-success uppercase">
                                  <ShieldCheck className="w-3.5 h-3.5" /> Verified by Agent 2
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 text-[10px] font-bold text-danger uppercase">
                                  <AlertCircle className="w-3.5 h-3.5" /> Agent 2 flagged
                                </div>
                              )}
                            </div>
                          </div>
                          
                          <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-4">
                              <div className="px-4 py-2 bg-bg-warm border border-border-neutral rounded text-sm font-bold text-ink-primary">
                                {task.ai_label}
                              </div>
                              <p className="text-xs text-ink-secondary italic leading-relaxed">
                                "{task.ai_reason}"
                              </p>
                            </div>

                            <div className="space-y-2">
                              <label className="text-[10px] font-bold text-ink-secondary uppercase tracking-widest">Human Label (Autosaves)</label>
                              <input 
                                type="text"
                                value={task.human_label || ""}
                                onChange={(e) => {
                                  const newVal = e.target.value;
                                  setTasks(prev => prev.map(t => t.id === task.id ? { ...t, human_label: newVal } : t));
                                  autosaveTask(task.id, newVal);
                                }}
                                placeholder="Enter final label..."
                                className="w-full bg-white border border-border-neutral rounded-md px-4 py-2 text-sm font-bold outline-none focus:border-ink-primary/20 transition-colors"
                              />
                            </div>

                            {task.validation_status !== 'correct' && (
                              <div className="p-4 bg-danger/5 border border-danger/10 rounded-lg">
                                <p className="text-[10px] font-bold text-danger uppercase mb-1">Validation Suggestion</p>
                                <p className="text-xs text-ink-primary font-medium">{task.validation_suggestion}</p>
                              </div>
                            )}
                          </div>

                          {task.status !== 'verified' && (
                            <div className="flex gap-3 pt-4 border-t border-border-neutral">
                              <button 
                                onClick={() => verifyTask(task.id, task.human_label || task.ai_label || "")}
                                className="flex-1 bg-ink-primary text-white px-6 py-2.5 rounded-md text-xs font-bold uppercase tracking-widest hover:bg-ink-primary/90 transition-all"
                              >
                                Finalize Verification
                              </button>
                              <button 
                                onClick={() => {
                                  const label = prompt("Enter correct label:", task.human_label || task.ai_label);
                                  if (label) {
                                    setTasks(prev => prev.map(t => t.id === task.id ? { ...t, human_label: label } : t));
                                    verifyTask(task.id, label);
                                  }
                                }}
                                className="px-6 py-2.5 bg-white border border-border-neutral text-ink-primary rounded-md text-xs font-bold uppercase tracking-widest hover:bg-bg-warm transition-all"
                              >
                                Manual Override
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        )}

        {view === "guidelines" && (
          <div className="max-w-4xl space-y-12">
            <header className="space-y-2">
              <p className="text-[10px] font-bold text-ink-secondary uppercase tracking-[0.2em]">System Configuration</p>
              <h2 className="text-4xl font-serif text-ink-primary">Annotation Guidelines</h2>
            </header>

            <div className="bg-white border border-border-neutral rounded-xl p-10 card-shadow space-y-10">
              <div className="space-y-12">
                {guidelines.map(g => (
                  <div key={g.id} className="group relative">
                    <div className="absolute -left-10 top-1 w-1 h-6 bg-ink-primary opacity-0 group-hover:opacity-100 transition-all" />
                    <h4 className="text-xl font-serif font-bold text-ink-primary mb-4">{g.title}</h4>
                    <div className="prose prose-sm max-w-none text-ink-secondary leading-relaxed">
                      <ReactMarkdown>{g.content}</ReactMarkdown>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex gap-4">
                <button 
                  onClick={() => setShowNewGuidelineModal(true)}
                  className="flex-1 border-2 border-dashed border-border-neutral hover:border-ink-primary/20 hover:bg-bg-warm/50 py-6 rounded-xl text-ink-secondary hover:text-ink-primary transition-all text-sm font-bold uppercase tracking-widest flex items-center justify-center gap-2"
                >
                  <Plus className="w-5 h-5" /> Manual Entry
                </button>
                <label className="flex-1 border-2 border-dashed border-border-neutral hover:border-ink-primary/20 hover:bg-bg-warm/50 py-6 rounded-xl text-ink-secondary hover:text-ink-primary transition-all text-sm font-bold uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer">
                  <Upload className="w-5 h-5" /> Upload .md File
                  <input type="file" accept=".md" onChange={handleMarkdownUpload} className="hidden" />
                </label>
              </div>
            </div>

            <div className="bg-ink-primary text-white rounded-xl p-8 flex items-center gap-8">
              <div className="w-12 h-12 bg-white/10 rounded-lg flex items-center justify-center shrink-0">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <h4 className="font-serif font-bold text-lg mb-1">Compliance Protocol Active</h4>
                <p className="text-sm text-white/70 leading-relaxed">
                  These rules are injected into the multi-agent reasoning chain. Updating these will immediately affect all subsequent AI labeling passes.
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* New Batch Modal */}
      <AnimatePresence>
        {showNewBatchModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewBatchModal(false)}
              className="absolute inset-0 bg-ink-primary/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              className="relative w-full max-w-2xl bg-white border border-border-neutral rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-10">
                <h2 className="text-3xl font-serif font-bold text-ink-primary mb-8">Initialize Batch</h2>
                <div className="space-y-8">
                  <div>
                    <label className="block text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-3">Session Identifier</label>
                    <input 
                      type="text" 
                      value={newBatchName}
                      onChange={e => setNewBatchName(e.target.value)}
                      placeholder="e.g. Sentiment Analysis - Project Alpha"
                      className="w-full bg-bg-warm border border-border-neutral rounded-md px-4 py-3 text-sm outline-none focus:border-ink-primary/20 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-3">Task Input (Newline Separated)</label>
                    <textarea 
                      rows={6}
                      value={newTasksInput}
                      onChange={e => setNewTasksInput(e.target.value)}
                      placeholder="Paste tasks here..."
                      className="w-full bg-bg-warm border border-border-neutral rounded-md px-4 py-3 text-sm outline-none focus:border-ink-primary/20 transition-colors font-mono scrollbar-hide"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-3">Taxonomy (Comma Separated Labels - Optional)</label>
                    <input 
                      type="text" 
                      value={taxonomyInput}
                      onChange={e => setTaxonomyInput(e.target.value)}
                      placeholder="e.g. Positive, Negative, Neutral"
                      className="w-full bg-bg-warm border border-border-neutral rounded-md px-4 py-3 text-sm outline-none focus:border-ink-primary/20 transition-colors"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-3">Project</label>
                      <select 
                        value={selectedProjectId}
                        onChange={e => setSelectedProjectId(e.target.value)}
                        className="w-full bg-bg-warm border border-border-neutral rounded-md px-4 py-3 text-sm outline-none focus:border-ink-primary/20 transition-colors"
                      >
                        <option value="">Select Project</option>
                        {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-3">Assign To</label>
                      <select 
                        value={selectedAssigneeId}
                        onChange={e => setSelectedAssigneeId(e.target.value)}
                        className="w-full bg-bg-warm border border-border-neutral rounded-md px-4 py-3 text-sm outline-none focus:border-ink-primary/20 transition-colors"
                      >
                        <option value="">Select Annotator</option>
                        {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex gap-4 pt-4">
                    <button 
                      onClick={() => setShowNewBatchModal(false)}
                      className="flex-1 px-6 py-3 rounded-md text-sm font-bold text-ink-secondary hover:bg-bg-warm transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={createBatch}
                      className="flex-1 px-6 py-3 rounded-md text-sm font-bold bg-ink-primary text-white shadow-lg shadow-ink-primary/10 hover:bg-ink-primary/90 transition-all"
                    >
                      Initialize Session
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* New Guideline Modal */}
      <AnimatePresence>
        {showNewGuidelineModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewGuidelineModal(false)}
              className="absolute inset-0 bg-ink-primary/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              className="relative w-full max-w-2xl bg-white border border-border-neutral rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-10">
                <h2 className="text-3xl font-serif font-bold text-ink-primary mb-8">New Guideline</h2>
                <div className="space-y-8">
                  <div>
                    <label className="block text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-3">Title</label>
                    <input 
                      type="text" 
                      value={newGuideline.title}
                      onChange={e => setNewGuideline(prev => ({ ...prev, title: e.target.value }))}
                      placeholder="e.g. Sentiment Nuances"
                      className="w-full bg-bg-warm border border-border-neutral rounded-md px-4 py-3 text-sm outline-none focus:border-ink-primary/20 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-3">Content (Markdown Supported)</label>
                    <textarea 
                      rows={10}
                      value={newGuideline.content}
                      onChange={e => setNewGuideline(prev => ({ ...prev, content: e.target.value }))}
                      placeholder="# Guideline Header\n- Rule 1\n- Rule 2"
                      className="w-full bg-bg-warm border border-border-neutral rounded-md px-4 py-3 text-sm outline-none focus:border-ink-primary/20 transition-colors font-mono"
                    />
                  </div>
                  <div className="flex gap-4 pt-4">
                    <button 
                      onClick={() => setShowNewGuidelineModal(false)}
                      className="flex-1 px-6 py-3 rounded-md text-sm font-bold text-ink-secondary hover:bg-bg-warm transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={async () => {
                        if (newGuideline.title && newGuideline.content) {
                          await fetch("/api/guidelines", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify(newGuideline),
                          });
                          fetchGuidelines();
                          setShowNewGuidelineModal(false);
                          setNewGuideline({ title: "", content: "" });
                        }
                      }}
                      className="flex-1 px-6 py-3 rounded-md text-sm font-bold bg-ink-primary text-white shadow-lg shadow-ink-primary/10 hover:bg-ink-primary/90 transition-all"
                    >
                      Save Guideline
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {showNewProjectModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNewProjectModal(false)}
              className="absolute inset-0 bg-ink-primary/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              className="relative w-full max-w-lg bg-white border border-border-neutral rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-10">
                <h2 className="text-3xl font-serif font-bold text-ink-primary mb-8">New Project</h2>
                <div className="space-y-6">
                  <div>
                    <label className="block text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-3">Project Name</label>
                    <input 
                      type="text" 
                      value={newProject.name}
                      onChange={e => setNewProject(p => ({ ...p, name: e.target.value }))}
                      placeholder="e.g. Content Moderation Q1"
                      className="w-full bg-bg-warm border border-border-neutral rounded-md px-4 py-3 text-sm outline-none focus:border-ink-primary/20 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-3">Description</label>
                    <textarea 
                      rows={3}
                      value={newProject.description}
                      onChange={e => setNewProject(p => ({ ...p, description: e.target.value }))}
                      placeholder="Project goals and context..."
                      className="w-full bg-bg-warm border border-border-neutral rounded-md px-4 py-3 text-sm outline-none focus:border-ink-primary/20 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-3">Deadline</label>
                    <input 
                      type="date" 
                      value={newProject.deadline}
                      onChange={e => setNewProject(p => ({ ...p, deadline: e.target.value }))}
                      className="w-full bg-bg-warm border border-border-neutral rounded-md px-4 py-3 text-sm outline-none focus:border-ink-primary/20 transition-colors"
                    />
                  </div>
                  <div className="flex gap-4 pt-4">
                    <button 
                      onClick={() => setShowNewProjectModal(false)}
                      className="flex-1 px-6 py-3 rounded-md text-sm font-bold text-ink-secondary hover:bg-bg-warm transition-all"
                    >
                      Cancel
                    </button>
                    <button 
                      onClick={createProject}
                      className="flex-1 px-6 py-3 rounded-md text-sm font-bold bg-ink-primary text-white shadow-lg shadow-ink-primary/10 hover:bg-ink-primary/90 transition-all"
                    >
                      Create Project
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Multimodal Modal */}
      <AnimatePresence>
        {showMultimodalModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowMultimodalModal(false)}
              className="absolute inset-0 bg-ink-primary/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.98, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 10 }}
              className="relative w-full max-w-lg bg-white border border-border-neutral rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-10">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-serif font-bold text-ink-primary">Add Multimodal Task</h2>
                  <button onClick={() => setShowMultimodalModal(false)} className="p-2 hover:bg-bg-warm rounded-full transition-colors">
                    <X className="w-5 h-5 text-ink-secondary" />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="flex gap-4">
                    <button 
                      onClick={() => setMultimodalForm(f => ({ ...f, type: 'image' }))}
                      className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                        multimodalForm.type === 'image' ? 'border-ink-primary bg-bg-warm' : 'border-border-neutral'
                      }`}
                    >
                      <ImageIcon className="w-6 h-6" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Image</span>
                    </button>
                    <button 
                      onClick={() => setMultimodalForm(f => ({ ...f, type: 'audio' }))}
                      className={`flex-1 flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
                        multimodalForm.type === 'audio' ? 'border-ink-primary bg-bg-warm' : 'border-border-neutral'
                      }`}
                    >
                      <Mic className="w-6 h-6" />
                      <span className="text-[10px] font-bold uppercase tracking-widest">Audio</span>
                    </button>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-ink-secondary uppercase tracking-widest mb-3">Description / Context</label>
                    <textarea 
                      rows={3}
                      value={multimodalForm.content}
                      onChange={e => setMultimodalForm(f => ({ ...f, content: e.target.value }))}
                      placeholder="What should the AI look for?"
                      className="w-full bg-bg-warm border border-border-neutral rounded-md px-4 py-3 text-sm outline-none focus:border-ink-primary/20 transition-colors"
                    />
                  </div>

                  <div className="relative group">
                    <input 
                      type="file" 
                      accept={multimodalForm.type === 'image' ? "image/*" : "audio/*"}
                      onChange={e => setMultimodalForm(f => ({ ...f, file: e.target.files?.[0] || null }))}
                      className="absolute inset-0 opacity-0 cursor-pointer z-10"
                    />
                    <div className="border-2 border-dashed border-border-neutral group-hover:border-ink-primary/20 rounded-xl p-8 text-center transition-all">
                      <Upload className="w-8 h-8 text-ink-secondary/30 mx-auto mb-2" />
                      <p className="text-xs font-medium text-ink-secondary">
                        {multimodalForm.file ? multimodalForm.file.name : "Click or drag to upload file"}
                      </p>
                    </div>
                  </div>

                  <button 
                    onClick={createMultimodalTask}
                    disabled={!multimodalForm.file}
                    className="w-full bg-ink-primary text-white py-3 rounded-md text-sm font-bold shadow-lg shadow-ink-primary/10 hover:bg-ink-primary/90 disabled:bg-border-neutral transition-all"
                  >
                    Upload & Initialize
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Processing Overlay */}
      <AnimatePresence>
        {isProcessing && (
          <div className="fixed bottom-8 right-8 z-[200] pointer-events-none">
            <motion.div 
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="bg-ink-primary text-white px-8 py-4 rounded-xl shadow-2xl flex items-center gap-4 border border-white/10"
            >
              <Loader2 className="w-5 h-5 animate-spin" />
              <div className="flex flex-col">
                <span className="text-xs font-bold uppercase tracking-widest">Multi-Agent Engine</span>
                <span className="text-[10px] text-white/60 uppercase tracking-tighter">Processing Neural Chain...</span>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
