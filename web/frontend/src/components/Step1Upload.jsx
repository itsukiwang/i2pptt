import { useState, useRef, useEffect } from 'react';
import axios from 'axios';

export function Step1Upload({ t, onUploadSuccess, onConfirm }) {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [uploadResult, setUploadResult] = useState(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState(null);
  const [fileProgress, setFileProgress] = useState({}); // { fileName: progress (0-100) }
  const [uploadedFileNames, setUploadedFileNames] = useState(new Set()); // Track which files have been uploaded
  const fileInputRef = useRef(null);
  const currentJobIdRef = useRef(null);
  
  // Clear job ID when component mounts to ensure new job is created for each upload session
  // This ensures each upload creates a fresh job
  useEffect(() => {
    currentJobIdRef.current = null;
  }, []);

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
  };

  const addFiles = (files) => {
    const newFiles = Array.from(files).filter(file => {
      // Check if file already exists
      return !uploadedFiles.find(f => f.name === file.name && f.size === file.size);
    });
    // If adding new files and we have no uploaded files at all, clear any existing job_id
    // This ensures a new job is created for a fresh upload session
    // But if we already have uploaded files, keep the job_id to continue adding to the same job
    if (uploadedFiles.length === 0 && uploadedFileNames.size === 0 && newFiles.length > 0) {
      currentJobIdRef.current = null;
    }
    // Clear errors when adding new files
    if (newFiles.length > 0) {
      setError(null);
    }
    setUploadedFiles(prev => [...prev, ...newFiles]);
  };

  const removeFile = (index) => {
    setUploadedFiles(prev => {
      const newFiles = [...prev];
      const removedFile = newFiles[index];
      newFiles.splice(index, 1);
      if (newFiles.length === 0) {
        setUploadResult(null);
        currentJobIdRef.current = null;
        setFileProgress({});
        setUploadedFileNames(new Set());
      } else if (removedFile) {
        // Remove progress and uploaded status for removed file
        setFileProgress(prevProgress => {
          const newProgress = { ...prevProgress };
          delete newProgress[removedFile.name];
          return newProgress;
        });
        setUploadedFileNames(prev => {
          const newSet = new Set(prev);
          newSet.delete(removedFile.name);
          return newSet;
        });
      }
      return newFiles;
    });
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    // Only set dragging to false if we're leaving the entire layout area
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      addFiles(files);
    }
  };

  const handleFileSelect = (e) => {
    if (e.target.files.length > 0) {
      addFiles(e.target.files);
    }
  };

  const handleUpload = async () => {
    // Get only files that haven't been uploaded yet
    const filesToUpload = uploadedFiles.filter(file => !uploadedFileNames.has(file.name));
    
    if (filesToUpload.length === 0) {
      setError((t.lang || 'en') === 'zh' ? '没有需要上传的文件' : 'No files to upload');
      return;
    }
    
    // Clear previous errors
    setError(null);

    setIsUploading(true);

    try {
      let accumulatedResult = null;
      let totalUploaded = 0;
      let totalExtractedDirs = [];

      // Upload files one by one
      for (const file of filesToUpload) {
        const form = new FormData();
        form.append('files', file); // Upload one file at a time
        form.append('extract', 'true');
        if (currentJobIdRef.current) {
          form.append('job_id', currentJobIdRef.current);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10 * 60 * 1000); // 10 minutes

        // Initialize progress for this file
        setFileProgress(prev => ({
          ...prev,
          [file.name]: 0
        }));

        const res = await axios.post('/api/upload', form, {
          signal: controller.signal,
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total) {
              // Real progress for this single file
              const fileProgress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
              setFileProgress(prev => ({
                ...prev,
                [file.name]: fileProgress
              }));
            }
          },
        });

        clearTimeout(timeoutId);

        const data = res.data;
        
        // Store job ID and session ID (from first upload)
        if (data.job_id && !currentJobIdRef.current) {
          currentJobIdRef.current = data.job_id;
          localStorage.setItem('i2pptt_current_job_id', data.job_id);
        }
        if (data.session_id) {
          // Set session cookie
          document.cookie = `session_id=${data.session_id}; path=/; max-age=3600`;
        }

        // Mark this file as uploaded with 100% progress
        // Use functional updates to ensure we get the latest state
        setFileProgress(prev => ({
          ...prev,
          [file.name]: 100
        }));
        setUploadedFileNames(prev => {
          const newSet = new Set(prev);
          newSet.add(file.name);
          return newSet;
        });

        // Accumulate results
        totalUploaded += data.count || 1;
        if (data.extracted_dirs) {
          totalExtractedDirs.push(...data.extracted_dirs);
        }
        if (!accumulatedResult) {
          accumulatedResult = data;
        } else {
          // Merge files
          accumulatedResult.files = [...(accumulatedResult.files || []), ...(data.files || [])];
        }
      }

      // Update upload result with accumulated data
      setUploadResult(prev => {
        if (prev) {
          return {
            ...prev,
            count: (prev.count || 0) + totalUploaded,
            files: [...(prev.files || []), ...(accumulatedResult.files || [])],
            extracted_dirs: [...(prev.extracted_dirs || []), ...totalExtractedDirs]
          };
        }
        return {
          ...accumulatedResult,
          count: totalUploaded,
          extracted_dirs: totalExtractedDirs
        };
      });
      setError(null); // Clear any previous errors on success
      
      // Show success message via window event
      const isZh = (t.lang || 'en') === 'zh';
      const successMessage = isZh
        ? `✓ 成功上传 ${totalUploaded} 个文件${totalExtractedDirs.length > 0 ? `，解压了 ${totalExtractedDirs.length} 个压缩包` : ''}`
        : `✓ Successfully uploaded ${totalUploaded} file(s)${totalExtractedDirs.length > 0 ? `, extracted ${totalExtractedDirs.length} archive(s)` : ''}`;
      
      window.dispatchEvent(new CustomEvent('showAlertInfo', { 
        detail: { 
          type: 'success', 
          message: successMessage
        } 
      }));
      
      // Call success callback
      if (onUploadSuccess && accumulatedResult) {
        onUploadSuccess(accumulatedResult);
      }
    } catch (error) {
      console.error('Upload error:', error);
      
      let errorMsg = '';
      const isZh = (t.lang || 'en') === 'zh';
      if (error.code === 'ECONNABORTED' || error.name === 'AbortError') {
        errorMsg = isZh
          ? `上传超时（总大小: ${totalSizeMB} MB）。大文件上传可能需要更长时间，请稍后重试或分批上传。`
          : `Upload timeout (total size: ${totalSizeMB} MB). Large files may take longer, please try again later or upload in batches.`;
      } else if (error.response) {
        const status = error.response.status;
        const detail = error.response.data?.detail || error.response.statusText;
        
        if (status === 413) {
          errorMsg = isZh 
            ? `文件太大（总大小: ${totalSizeMB} MB）。服务器可能限制了文件大小。`
            : `File too large (total size: ${totalSizeMB} MB). Server may have file size limits.`;
        } else if (status === 408 || status === 504) {
          errorMsg = isZh
            ? `上传超时（总大小: ${totalSizeMB} MB）。请尝试分批上传较小的文件。`
            : `Upload timeout (total size: ${totalSizeMB} MB). Please try uploading smaller files in batches.`;
        } else if (status === 500) {
          errorMsg = isZh
            ? `服务器错误: ${detail}。请检查文件格式是否正确。`
            : `Server error: ${detail}. Please check if file formats are correct.`;
        } else {
          errorMsg = isZh
            ? `上传失败 (HTTP ${status}): ${detail}`
            : `Upload failed (HTTP ${status}): ${detail}`;
        }
      } else if (error.message) {
        errorMsg = error.message;
      } else {
        errorMsg = isZh ? '上传失败: ' + String(error) : 'Upload failed: ' + String(error);
      }
      
      setError(errorMsg);
      // On error, don't mark any files as uploaded
      // Progress will remain at current state
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirm = () => {
    console.log('handleConfirm called, uploadResult:', uploadResult);
    console.log('currentJobIdRef.current:', currentJobIdRef.current);
    console.log('localStorage job_id:', localStorage.getItem('i2pptt_current_job_id'));
    
    // Clear previous errors
    setError(null);
    
    if (!uploadResult) {
      setError((t.lang || 'en') === 'zh' ? '请先上传文件' : 'Please upload files first');
      return;
    }
    
    // Try multiple sources for job_id
    const jobId = uploadResult.job_id 
      || currentJobIdRef.current 
      || localStorage.getItem('i2pptt_current_job_id');
    
    console.log('Resolved jobId:', jobId);
    
    if (!jobId) {
      console.error('No job_id found in any source:', {
        uploadResult: uploadResult,
        currentJobIdRef: currentJobIdRef.current,
        localStorage: localStorage.getItem('i2pptt_current_job_id')
      });
      setError((t.lang || 'en') === 'zh' ? '上传结果中缺少 Job ID，请重新上传' : 'Missing Job ID in upload result, please upload again');
      return;
    }
    
    // Update uploadResult with job_id if missing
    const resultWithJobId = { ...uploadResult, job_id: jobId };
    console.log('Calling onConfirm with job_id:', jobId, 'result:', resultWithJobId);
    
    if (onConfirm) {
      onConfirm(resultWithJobId);
    } else {
      console.warn('onConfirm callback not provided');
    }
  };

  return (
    <div className="upload-form">
      <div 
        className={`upload-layout ${isDragging ? 'dragging' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="upload-drop-area">
          <label className="field-label">{t.step1.fileLabel || 'Files'}</label>
          <div
            className={`drop-zone ${isDragging ? 'dragover' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            style={{ cursor: 'pointer' }}
          >
            <div>{t.step1.dropZoneText}</div>
            <div style={{ fontSize: '0.85rem', color: '#52606d', marginTop: '0.5rem' }}>
              {t.step1.dropZoneHint}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.zip,.rar,.7z"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
          </div>
        </div>

        <div className={`upload-file-list ${isDragging ? 'hidden' : ''}`}>
          <label className="field-label">{uploadedFiles.length > 0 ? (t.lang || 'en') === 'zh' ? `已选 ${uploadedFiles.length} 个文件` : `Selected ${uploadedFiles.length} Files` : ''}</label>
          {uploadedFiles.length > 0 ? (
            <div className="file-list">
              {uploadedFiles.map((file, index) => {
                const progress = fileProgress[file.name] || 0;
                const isUploaded = uploadedFileNames.has(file.name);
                const isCompleted = isUploaded && progress === 100;
                return (
                  <div key={index} className={`file-item ${isUploaded ? 'file-uploaded' : 'file-not-uploaded'}`}>
                    <span className="file-item-name" title={file.name}>{file.name}</span>
                    <span className="file-item-size">{formatFileSize(file.size)}</span>
                    <div className="file-item-progress">
                      <svg className="progress-circle" viewBox="0 0 36 36">
                        <circle
                          className="progress-circle-bg"
                          cx="18"
                          cy="18"
                          r="12"
                          fill="none"
                          stroke={isCompleted ? "#dbeafe" : "#e2e8f0"}
                          strokeWidth="5"
                        />
                        <circle
                          className="progress-circle-fg"
                          cx="18"
                          cy="18"
                          r="12"
                          fill="none"
                          stroke={isCompleted ? "#60a5fa" : "#94a3b8"}
                          strokeWidth="5"
                          strokeDasharray={`${progress * 75.4 / 100}, 75.4`}
                          strokeDashoffset="0"
                          transform="rotate(-90 18 18)"
                        />
                      </svg>
                    </div>
                    <button
                      className="file-item-remove"
                      onClick={() => removeFile(index)}
                      title={t.step1.removeFile}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>
              {(t.lang || 'en') === 'zh' ? '暂无文件' : 'No files selected'}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div style={{ 
          marginTop: '1rem', 
          padding: '1rem', 
          background: '#fee2e2', 
          border: '1px solid #fecaca',
          borderRadius: '0.5rem',
          color: '#991b1b'
        }}>
          <p style={{ margin: 0, fontWeight: 500 }}>⚠ {error}</p>
        </div>
      )}

      <div className="actions" style={{ marginTop: '1rem', justifyContent: 'flex-end', gap: '0.75rem' }}>
        <button
          className="primary-soft"
          onClick={handleUpload}
          disabled={
            uploadedFiles.length === 0 || 
            uploadedFiles.filter(f => !uploadedFileNames.has(f.name)).length === 0 || 
            isUploading
          }
        >
          {isUploading ? t.step1.uploading + '...' : t.step1.startUpload}
        </button>
        <button
          className="primary"
          onClick={handleConfirm}
          disabled={
            uploadedFiles.length === 0 || 
            (uploadedFiles.length <= 1 && !uploadResult?.extracted_dirs?.length) || 
            uploadedFiles.some(f => {
              const isUploaded = uploadedFileNames.has(f.name);
              const progress = fileProgress[f.name] || 0;
              // File must be in uploadedFileNames AND have 100% progress
              return !isUploaded || progress < 100;
            }) ||
            isUploading
          }
        >
          {t.step1.confirmAndNext} ▶
        </button>
      </div>
    </div>
  );
}

