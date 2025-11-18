import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { TabBar } from './components/TabBar.jsx';
import { ProgressBar } from './components/ProgressBar.jsx';
import { Step1Upload } from './components/Step1Upload.jsx';
import { Step2Analyze } from './components/Step2Analyze.jsx';
import { Step3Generate } from './components/Step3Generate.jsx';

// Auto-detect API base URL for development and production environments
const getApiBaseURL = () => {
  const viteBaseURL = import.meta.env.BASE_URL || '/';
  const isDev = import.meta.env.DEV;
  const { hostname, pathname: currentPath, port } = window.location;
  
  // Local development: always use empty string for Vite proxy
  const isLocalDev = (isDev && ['localhost', '127.0.0.1'].includes(hostname)) ||
                     ['localhost', '127.0.0.1'].includes(hostname) ||
                     port === '5174' ||
                     port === '5173';
  
  if (isLocalDev) return '';
  
  // Production: use configured base path or infer from current path
  if (viteBaseURL !== '/') {
    return viteBaseURL.replace(/\/$/, '');
  }
  
  const pathSegments = currentPath.split('/').filter(Boolean);
  return pathSegments.length > 0 ? `/${pathSegments[0]}` : '';
};

const apiBaseURL = getApiBaseURL();
axios.defaults.baseURL = apiBaseURL;
window.__API_BASE_URL__ = apiBaseURL;

const UI_TEXT = {
  en: {
    tabs: [
      { id: 1, label: 'Upload' },
      { id: 2, label: 'Analyze' },
      { id: 3, label: 'Generate' },
    ],
    header: {
      title: 'Images to PPT Tool',
      subtitle: 'Images → PPT pipeline (scan → merge)',
      homeButton: 'Back to Home',
      jobIdLabel: 'Job ID',
      statusLabel: 'Status',
      showTerminal: 'Show terminal',
      hideTerminal: 'Hide terminal',
    },
    terminal: {
      title: 'Terminal Output',
      empty: 'No terminal output yet.',
      toggleExpand: 'Show terminal output',
      toggleCollapse: 'Hide terminal output',
    },
    step1: {
      title: 'Step 1 · Upload',
      description: 'Support images or zip (auto-extract keeps folder structure)',
      dropZoneText: 'Drag and drop files here, or click to select',
      dropZoneHint: 'Support multiple images or zip files',
      startUpload: 'Start Upload',
      uploading: 'Uploading...',
      confirmAndNext: 'Confirm & Next',
      removeFile: 'Remove',
    },
    step2: {
      title: 'Step 2 · Analyze (scan)',
      description: 'Analyzing uploaded files and generating structure preview...',
      analyzing: 'Analyzing file structure...',
      analysisComplete: '✓ Analysis complete',
      analysisFailed: 'Analysis failed',
      previewTitle: 'Analysis Preview',
      confirmAndNext: 'Confirm & Next',
    },
    step3: {
      title: 'Step 3 · Generate (merge)',
      description: 'Generate PPT from structure MD',
      generate: 'Generate',
    },
  },
  zh: {
    tabs: [
      { id: 1, label: '上传' },
      { id: 2, label: '分析' },
      { id: 3, label: '合并' },
    ],
    header: {
      title: '图片转 PPT 工具',
      subtitle: '图片 → PPT 流程（扫描 → 合并）',
      homeButton: '回到首页',
      jobIdLabel: '任务编号',
      statusLabel: '状态',
      showTerminal: '显示终端',
      hideTerminal: '隐藏终端',
    },
    terminal: {
      title: '终端输出',
      empty: '暂无终端输出。',
      toggleExpand: '显示终端输出',
      toggleCollapse: '隐藏终端输出',
    },
    step1: {
      title: '步骤一 · 上传',
      description: '支持图片或 zip（自动解压保留目录结构）',
      fileLabel: '文件',
      dropZoneText: '拖拽文件到此处，或点击选择',
      dropZoneHint: '支持多个图片或 zip 文件',
      startUpload: '开始上传',
      uploading: '上传中...',
      confirmAndNext: '确认并进入下一步',
      removeFile: '移除',
      noFiles: '请先选择文件',
    },
    step2: {
      title: '步骤二 · 分析（扫描）',
      description: '正在分析上传的文件并生成结构预览...',
      analyzing: '正在分析文件结构...',
      analysisComplete: '✓ 分析完成',
      analysisFailed: '分析失败',
      previewTitle: '分析结果预览',
      confirmAndNext: '确认并进入下一步',
    },
    step3: {
      title: '步骤三 · 合并（生成）',
      description: '根据结构 MD 合并生成 PPT',
      generate: '生成',
      downloading: '下载中...',
      download: '下载 PPT',
    },
  },
};

function App() {
  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem('i2pptt_language') || 'en';
    return saved === 'zh' ? 'zh' : 'en';
  });
  const [currentStep, setCurrentStep] = useState(1);
  const [maxReachedStep, setMaxReachedStep] = useState(1);
  const [currentJobId, setCurrentJobId] = useState(() => {
    // Restore job ID from localStorage on mount
    return localStorage.getItem('i2pptt_current_job_id') || null;
  });
  const [currentJob, setCurrentJob] = useState(null);
  const [isTerminalOpen, setIsTerminalOpen] = useState(false);
  const [terminalLog, setTerminalLog] = useState('');
  const [alertInfo, setAlertInfo] = useState(null);
  
  const t = { ...UI_TEXT[lang], lang };
  
  useEffect(() => {
    localStorage.setItem('i2pptt_language', lang);
  }, [lang]);

  // Save job ID to localStorage when it changes
  useEffect(() => {
    if (currentJobId) {
      localStorage.setItem('i2pptt_current_job_id', currentJobId);
    } else {
      localStorage.removeItem('i2pptt_current_job_id');
    }
  }, [currentJobId]);
  

  // Fetch job info when jobId changes
  useEffect(() => {
    const fetchJob = async () => {
      if (!currentJobId) {
        setCurrentJob(null);
        return;
      }

      try {
        const response = await axios.get(`/api/jobs/${currentJobId}`);
        setCurrentJob(response.data);
      } catch (err) {
        setCurrentJob(null);
      }
    };

    fetchJob();
    
    // Poll job status every 2 seconds if job exists
    const interval = setInterval(fetchJob, 2000);
    return () => clearInterval(interval);
  }, [currentJobId]);
  
  const handleStepChange = (step) => {
    // If going back to step 1, clear job state to allow new job creation
    if (step === 1) {
      setCurrentJobId(null);
      setCurrentJob(null);
      localStorage.removeItem('i2pptt_current_job_id');
      setMaxReachedStep(1);
    }
    if (step <= maxReachedStep) {
      setCurrentStep(step);
    }
  };

  const handleUploadSuccess = (uploadResult) => {
    if (uploadResult.job_id) {
      const jobId = uploadResult.job_id;
      setCurrentJobId(jobId);
      localStorage.setItem('i2pptt_current_job_id', jobId);
      // Fetch job info immediately
      axios.get(`/api/jobs/${jobId}`)
        .then(response => setCurrentJob(response.data))
        .catch(() => {});
    }
  };

  const handleConfirmUpload = (uploadResult) => {
    if (uploadResult) {
      if (uploadResult.job_id) {
        const jobId = uploadResult.job_id;
        setCurrentJobId(jobId);
        localStorage.setItem('i2pptt_current_job_id', jobId);
        
        // Fetch job info immediately
        axios.get(`/api/jobs/${jobId}`)
          .then(response => {
            setCurrentJob(response.data);
          })
          .catch(() => {});
      }
      // Always allow moving to step 2 after upload confirmation
      // Use functional updates to ensure state is updated correctly
      setMaxReachedStep((prev) => Math.max(prev, 2));
      // Use setTimeout to ensure state is updated before changing step
      setTimeout(() => {
        setCurrentStep(() => 2);
      }, 100);
    } else {
      // Error will be shown in Step1Upload component
      setCurrentStep(1);
    }
  };
  
  // Terminal log functions
  const appendLog = (message) => {
    if (!message) return;
    setTerminalLog((prev) => (prev ? `${prev}\n${message}` : message));
  };
  
  // Format terminal output with command highlighting
  const formatTerminalOutput = (text) => {
    if (!text || typeof text !== 'string') return [{ type: 'output', content: String(text || '') }];
    
    try {
      // Regular expression to match command lines
      // Matches lines starting with $, #, >, % (common shell prompts) or common command prefixes
      const commandPattern = /(^|\n)(\s*)(\$|#|>|%|python3?|\.\/i2pptt|cli\/i2pptt|i2pptt|uvicorn|npm|node|pip|pip3)[^\n]*/gm;
      
      const parts = [];
      let lastIndex = 0;
      let match;
      
      // Reset regex
      commandPattern.lastIndex = 0;
      
      while ((match = commandPattern.exec(text)) !== null) {
        // Add text before the match (non-command output)
        if (match.index > lastIndex) {
          parts.push({
            type: 'output',
            content: text.substring(lastIndex, match.index)
          });
        }
        
        // Add the command (including the prompt/prefix)
        let commandContent = match[0];
        // Remove leading newline if present
        if (commandContent.startsWith('\n')) {
          commandContent = commandContent.substring(1);
        }
        parts.push({
          type: 'command',
          content: commandContent
        });
        
        lastIndex = match.index + match[0].length;
      }
      
      // Add remaining text
      if (lastIndex < text.length) {
        parts.push({
          type: 'output',
          content: text.substring(lastIndex)
        });
      }
      
      return parts.length > 0 ? parts : [{ type: 'output', content: text }];
    } catch (err) {
      console.error('Error in formatTerminalOutput:', err);
      return [{ type: 'output', content: String(text) }];
    }
  };
  
  // Fetch terminal log from backend
  const fetchTerminalLog = useCallback(async (jobId, logType = 'all') => {
    if (!jobId) return;
    try {
      const response = await axios.get(`/api/jobs/${jobId}/log`, {
        params: { log_type: logType }
      });
      if (response.data) {
        setTerminalLog((prev) => {
          const newLog = response.data.trim();
          // If we already have this log, don't duplicate
          if (prev && prev.includes(newLog)) {
            return prev;
          }
          // Append new log or replace if empty
          return prev ? `${prev}\n${newLog}` : newLog;
        });
      }
    } catch (err) {
      // Silently fail - log might not exist yet
    }
  }, []);
  
  // Listen for terminal log fetch events from child components
  useEffect(() => {
    const handleFetchTerminalLog = async (event) => {
      const { jobId, logType } = event.detail;
      if (jobId) {
        await fetchTerminalLog(jobId, logType);
      }
    };
    
    window.addEventListener('fetchTerminalLog', handleFetchTerminalLog);
    return () => {
      window.removeEventListener('fetchTerminalLog', handleFetchTerminalLog);
    };
  }, [fetchTerminalLog]);

  // Listen for alert info events from child components
  useEffect(() => {
    const handleShowAlertInfo = (event) => {
      const { type, message } = event.detail;
      setAlertInfo({ type, message });
      // Auto-hide after 5 seconds
      setTimeout(() => {
        setAlertInfo(null);
      }, 5000);
    };

    window.addEventListener('showAlertInfo', handleShowAlertInfo);
    return () => {
      window.removeEventListener('showAlertInfo', handleShowAlertInfo);
    };
  }, []);
  
  return (
    <div className="app-shell">
      {/* Terminal panel (conditionally rendered, before app-header) */}
      {isTerminalOpen && (
        <section className="terminal-panel open" aria-live="polite">
          <div className="terminal-header">
            <h3>{t.terminal.title}</h3>
            <button
              type="button"
              className="terminal-toggle"
              onClick={() => setIsTerminalOpen(false)}
            >
              {t.terminal.toggleCollapse}
            </button>
          </div>
          <div className="terminal-window">
            <pre>
              {terminalLog ? (
                (() => {
                  try {
                    const parts = formatTerminalOutput(terminalLog);
                    if (!parts || parts.length === 0) {
                      return t.terminal.empty;
                    }
                    return parts.map((part, index) => {
                      if (part.type === 'command') {
                        return (
                          <span key={index} className="terminal-command">
                            {part.content}
                          </span>
                        );
                      }
                      return (
                        <span key={index} className="terminal-output">
                          {part.content}
                        </span>
                      );
                    });
                  } catch (err) {
                    console.error('Error formatting terminal output:', err);
                    return <span className="terminal-output">{terminalLog}</span>;
                  }
                })()
              ) : (
                t.terminal.empty
              )}
            </pre>
          </div>
        </section>
      )}
      
      <header className="app-header">
        <div>
          <h1>{t.header.title}</h1>
          <p>{t.header.subtitle}</p>
        </div>
        <div className="header-controls">
          <div className="header-actions">
            <div className="button-group">
              <a
                href="/"
                className="home-button"
                title={lang === 'zh' ? '返回首页' : 'Return to Home'}
              >
                {t.header.homeButton}
              </a>
              <span className="button-divider">|</span>
              <button
                type="button"
                className="show-terminal-button"
                onClick={() => setIsTerminalOpen((prev) => !prev)}
                title={lang === 'zh' ? (isTerminalOpen ? '隐藏终端输出' : '显示终端输出') : (isTerminalOpen ? 'Hide terminal output' : 'Show terminal output')}
              >
                {isTerminalOpen ? t.header.hideTerminal : t.header.showTerminal}
              </button>
              <span className="button-divider">|</span>
              <button
                type="button"
                className={lang === 'en' ? 'active' : ''}
                onClick={() => setLang('en')}
              >
                EN
              </button>
              <button
                type="button"
                className={lang === 'zh' ? 'active' : ''}
                onClick={() => setLang('zh')}
              >
                中
              </button>
            </div>
          </div>
          {(() => {
            const jobId = currentJobId || localStorage.getItem('i2pptt_current_job_id');
            const status = currentJob?.status;
            // Only show if we have a job ID and (status or we're past step 1)
            if (jobId && (status || currentStep > 1)) {
              return (
                <div className="status-info">
                  <span>
                    {t.header.jobIdLabel}: {jobId}
                  </span>
                  <span>
                    {t.header.statusLabel}: {status || '-'}
                  </span>
                </div>
              );
            }
            return null;
          })()}
        </div>
      </header>
      
      <TabBar
        tabs={t.tabs}
        current={currentStep}
        maxReached={maxReachedStep}
        onChange={handleStepChange}
      />
      
      {/* Alert info messages (after tab-bar, before panel) */}
      {alertInfo && (
        <div 
          className={`alert alert-${alertInfo.type || 'info'}`}
          role={alertInfo.type === 'error' ? 'alert' : 'status'}
          style={{ 
            marginTop: isTerminalOpen ? '1rem' : '0',
            marginBottom: '1rem'
          }}
        >
          {alertInfo.message}
        </div>
      )}
      
      <section className="panel" aria-labelledby={`step${currentStep}-title`}>
        <header>
          <h2 id={`step${currentStep}-title`}>
            {currentStep === 1 && t.step1.title}
            {currentStep === 2 && t.step2.title}
            {currentStep === 3 && t.step3.title}
          </h2>
          <p>
            {currentStep === 1 && t.step1.description}
            {currentStep === 2 && t.step2.description}
            {currentStep === 3 && t.step3.description}
          </p>
        </header>
        
        <div className="panel-content">
          {currentStep === 1 && (
            <Step1Upload
              t={t}
              onUploadSuccess={handleUploadSuccess}
              onConfirm={handleConfirmUpload}
            />
          )}
          
          {currentStep === 2 && (
            <Step2Analyze
              t={t}
              jobId={currentJobId || localStorage.getItem('i2pptt_current_job_id')}
              onAnalysisComplete={async (result) => {
                // Update job if provided
                if (result.job) {
                  setCurrentJob(result.job);
                }
                // Ensure jobId is set if we got it from result
                const jobId = result.job_id || currentJobId || localStorage.getItem('i2pptt_current_job_id');
                if (jobId && !currentJobId) {
                  setCurrentJobId(jobId);
                  localStorage.setItem('i2pptt_current_job_id', jobId);
                }
                // Show success message
                setAlertInfo({ type: 'success', message: t.step2.analysisComplete });
                // Auto-hide after 5 seconds
                setTimeout(() => {
                  setAlertInfo(null);
                }, 5000);
                // Terminal log will be fetched automatically by Step2Analyze component
                setMaxReachedStep((prev) => Math.max(prev, 3));
              }}
              onConfirm={(result) => {
                setMaxReachedStep((prev) => Math.max(prev, 3));
                setCurrentStep(3);
              }}
            />
          )}
          
          {currentStep === 3 && (
            <Step3Generate
              t={t}
              jobId={currentJobId || localStorage.getItem('i2pptt_current_job_id')}
              job={currentJob}
            />
          )}
        </div>
      </section>
      
      <footer className="app-footer">
        <p>The app's code was written in AI.</p>
      </footer>
    </div>
  );
}

export default App;

