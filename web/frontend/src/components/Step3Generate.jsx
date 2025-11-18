import { useState, useEffect } from 'react';
import axios from 'axios';

// Format file size helper
const formatFileSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '-';
  }
  if (bytes === 0) {
    return '0 B';
  }
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 1)} ${sizes[i]}`;
};

export function Step3Generate({ t, jobId, job }) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateResult, setGenerateResult] = useState(null);
  const [error, setError] = useState(null);
  const [pptxPath, setPptxPath] = useState(null);
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [pptxSize, setPptxSize] = useState(null);

  // Load job info if not provided
  useEffect(() => {
    const loadJob = async () => {
      const effectiveJobId = jobId || localStorage.getItem('i2pptt_current_job_id');
      if (!job && effectiveJobId) {
        try {
          const response = await axios.get(`/api/jobs/${effectiveJobId}`);
          // Job will be passed from parent, so we don't set it here
          // Just log for debugging
          console.log('Step3Generate: Job loaded:', response.data);
        } catch (err) {
          console.warn('Step3Generate: Failed to load job:', err);
        }
      }
    };
    loadJob();
  }, [jobId, job]);

  const startGeneration = async () => {
    if (!jobId) {
      const savedJobId = localStorage.getItem('i2pptt_current_job_id');
      if (!savedJobId) {
        setError((t.lang || 'en') === 'zh' ? '缺少 Job ID' : 'Missing Job ID');
        return;
      }
      // Try to load job info
      try {
        const response = await axios.get(`/api/jobs/${savedJobId}`);
        const jobData = response.data;
        if (jobData.md_path && jobData.directory && jobData.filename) {
          await doGenerate(jobData.directory, jobData.filename, savedJobId);
        } else {
          setError((t.lang || 'en') === 'zh' ? '缺少必要的 job 信息（directory, filename, md_path）' : 'Missing required job info (directory, filename, md_path)');
        }
      } catch (err) {
        setError((t.lang || 'en') === 'zh' ? '无法加载 job 信息' : 'Failed to load job info');
      }
      return;
    }

    if (!job) {
      setError((t.lang || 'en') === 'zh' ? '缺少 job 信息' : 'Missing job info');
      return;
    }

    if (!job.md_path || !job.directory || !job.filename) {
      setError((t.lang || 'en') === 'zh' ? '缺少必要的 job 信息（directory, filename, md_path）' : 'Missing required job info (directory, filename, md_path)');
      return;
    }

    await doGenerate(job.directory, job.filename, jobId);
  };

  const doGenerate = async (directory, filename, jobIdToUse) => {
    setIsGenerating(true);
    setError(null);
    setGenerateResult(null);
    setPptxPath(null);
    setDownloadUrl(null);
    setPptxSize(null);

    // Show generating message in alert
    window.dispatchEvent(new CustomEvent('showAlertInfo', { 
      detail: { 
        type: 'info', 
        message: (t.lang || 'en') === 'zh' ? '正在生成 PPT...' : 'Generating PPT...'
      } 
    }));

    // Trigger terminal log fetch for generate (before starting)
    window.dispatchEvent(new CustomEvent('fetchTerminalLog', { 
      detail: { jobId: jobIdToUse, logType: 'generate' } 
    }));

    try {
      console.log('Calling /api/generate with job_id:', jobIdToUse, 'directory:', directory, 'filename:', filename);
      const response = await axios.post('/api/generate', null, {
        params: {
          job_id: jobIdToUse,
          directory: directory,
          filename: filename,
        },
      });

      console.log('Generate response:', response.data);
      const data = response.data;
      setGenerateResult(data);
      setPptxPath(data.pptx);

      // Create download URL and get file size
      if (data.pptx && jobIdToUse) {
        const downloadUrl = `/api/jobs/${jobIdToUse}/download`;
        setDownloadUrl(downloadUrl);
        
        // Get file size from response first (backend returns it in pptx_size)
        let fileSize = data.pptx_size;
        console.log('File size from response:', fileSize, 'data:', data);
        
        // If not in response, try to get from job details
        if (!fileSize || fileSize <= 0) {
          try {
            const jobResponse = await axios.get(`/api/jobs/${jobIdToUse}`);
            fileSize = jobResponse.data.details?.pptx_size;
            console.log('File size from job details:', fileSize);
          } catch (err) {
            console.warn('Failed to fetch job details:', err);
          }
        }
        
        // If still no size, fetch using HEAD request
        if (!fileSize || fileSize <= 0) {
          try {
            const headResponse = await fetch(downloadUrl, { method: 'HEAD' });
            if (headResponse.ok) {
              const contentLength = headResponse.headers.get('Content-Length');
              console.log('Content-Length from HEAD:', contentLength);
              if (contentLength) {
                const size = parseInt(contentLength, 10);
                if (size > 0) {
                  fileSize = size;
                }
              }
            }
          } catch (err) {
            console.warn('Failed to fetch file size:', err);
          }
        }
        
        // Set file size if we have it
        if (fileSize && fileSize > 0) {
          setPptxSize(fileSize);
          console.log('Setting pptxSize to:', fileSize);
        } else {
          console.warn('No valid file size found');
        }
      }
      
      // Show success message via window event
      window.dispatchEvent(new CustomEvent('showAlertInfo', { 
        detail: { 
          type: 'success', 
          message: (t.lang || 'en') === 'zh' ? '✓ PPT 生成成功' : '✓ PPT generated successfully'
        } 
      }));

      // Update job status and fetch terminal log
      if (jobIdToUse) {
        try {
          await axios.get(`/api/jobs/${jobIdToUse}`);
          // Fetch terminal log - trigger parent's fetchTerminalLog via window event
          window.dispatchEvent(new CustomEvent('fetchTerminalLog', { 
            detail: { jobId: jobIdToUse, logType: 'generate' } 
          }));
        } catch (err) {
          console.warn('Failed to refresh job after generation:', err);
        }
      }
    } catch (err) {
      console.error('Generation error:', err);
      let errorMsg = '';
      const isZh = (t.lang || 'en') === 'zh';

      if (err.response) {
        const status = err.response.status;
        const detail = err.response.data?.detail || err.response.statusText;
        errorMsg = isZh
          ? `生成失败 (HTTP ${status}): ${detail}`
          : `Generation failed (HTTP ${status}): ${detail}`;
        console.error('Generation failed with status:', status, 'detail:', detail);
      } else if (err.message) {
        errorMsg = err.message;
        console.error('Generation failed with message:', err.message);
      } else {
        errorMsg = isZh ? '生成失败: ' + String(err) : 'Generation failed: ' + String(err);
        console.error('Generation failed:', err);
      }

      setError(errorMsg);
      
      // Fetch terminal log even on error to show what happened
      const effectiveJobId = jobId || localStorage.getItem('i2pptt_current_job_id');
      if (effectiveJobId) {
        window.dispatchEvent(new CustomEvent('fetchTerminalLog', { 
          detail: { jobId: effectiveJobId, logType: 'generate' } 
        }));
      }
    } finally {
      console.log('Generation finished, setting isGenerating to false');
      setIsGenerating(false);
    }
  };

  const handleDownload = () => {
    if (downloadUrl) {
      window.open(downloadUrl, '_blank');
    }
  };

  const handleStartNewJob = () => {
    // Clear job state and go back to step 1
    localStorage.removeItem('i2pptt_current_job_id');
    window.location.href = '/';
  };

  return (
    <div className="generate-form">


      {error && (
        <div style={{ padding: '1rem', background: '#fee2e2', color: '#991b1b', borderRadius: '0.5rem', marginBottom: '1rem' }}>
          <strong>{(t.lang || 'en') === 'zh' ? '错误' : 'Error'}:</strong> {error}
          <button
            onClick={startGeneration}
            style={{ marginLeft: '1rem', padding: '0.5rem 1rem', background: '#dc2626', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}
          >
            {(t.lang || 'en') === 'zh' ? '重试' : 'Retry'}
          </button>
        </div>
      )}

      {/* File summary - show if we have a result */}
      {pptxPath && generateResult && !isGenerating && (
        <div className="file-summary" style={{ marginBottom: '1rem' }}>
          <p style={{ margin: 0 }}>
            {(t.lang || 'en') === 'zh' ? '文件' : 'File'}{' '}
            <span className="file-size-highlight">
              {pptxPath.split('/').pop()}
              {pptxSize && Number.isFinite(pptxSize) && pptxSize > 0 && (
                <> ({formatFileSize(pptxSize)})</>
              )}
            </span>
          </p>
        </div>
      )}

      {/* Action buttons - always show */}
      <div className="actions" style={{ marginTop: '1rem', justifyContent: 'flex-end', gap: '0.75rem' }}>
        <button
          className="secondary"
          onClick={handleStartNewJob}
        >
          {(t.lang || 'en') === 'zh' ? '开始新任务 ⏎' : 'Start New Job ⏎'}
        </button>
        <button
          className={`primary-soft ${isGenerating ? 'loading' : ''}`}
          onClick={startGeneration}
          disabled={isGenerating || !job?.md_path || !job?.directory || !job?.filename}
        >
          {isGenerating ? ((t.lang || 'en') === 'zh' ? '生成中...' : 'Generating...') : t.step3.generate}
        </button>
        <button
          className="primary"
          onClick={handleDownload}
          disabled={!downloadUrl || isGenerating}
        >
          {(t.lang || 'en') === 'zh' ? '下载 PPT ⬇' : 'Download PPT ⬇'}
        </button>
      </div>
    </div>
  );
}

