import { useState, useEffect } from 'react';
import axios from 'axios';

export function Step2Analyze({ t, jobId, onAnalysisComplete, onConfirm }) {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [error, setError] = useState(null);
  const [mdContent, setMdContent] = useState('');
  const [activeTab, setActiveTab] = useState('preview'); // 'preview' or 'markdown'

  useEffect(() => {
    console.log('Step2Analyze useEffect triggered, jobId prop:', jobId);
    // Try to get jobId from localStorage if not provided
    const savedJobId = localStorage.getItem('i2pptt_current_job_id');
    const effectiveJobId = jobId || savedJobId;
    console.log('Effective jobId (prop || localStorage):', effectiveJobId);
    
    if (effectiveJobId) {
      // If jobId prop is missing but we have saved one, use it
      if (!jobId && savedJobId) {
        console.warn('Step2Analyze: jobId prop missing, using saved from localStorage:', savedJobId);
        // Wait a bit for parent component to potentially update
        const timer = setTimeout(() => {
          const currentSaved = localStorage.getItem('i2pptt_current_job_id');
          if (currentSaved) {
            console.log('Starting analysis with saved jobId:', currentSaved);
            startAnalysisWithJobId(currentSaved);
          }
        }, 300);
        return () => clearTimeout(timer);
      } else if (jobId) {
        console.log('Starting analysis with jobId prop:', jobId);
        startAnalysis();
      }
    } else {
      console.warn('Step2Analyze: No jobId provided and no saved jobId in localStorage');
      setError((t.lang || 'en') === 'zh' ? '缺少 Job ID，请返回第一步重新上传' : 'Missing Job ID, please go back to step 1 and upload again');
    }
  }, [jobId]);

  const startAnalysisWithJobId = async (jobIdToUse) => {
    if (!jobIdToUse) {
      setError((t.lang || 'en') === 'zh' ? '缺少 Job ID' : 'Missing Job ID');
      return;
    }

    console.log('Starting analysis for jobId:', jobIdToUse);
    setIsAnalyzing(true);
    setError(null);
    setAnalysisResult(null);
    setMdContent('');

    // Trigger terminal log fetch for analyze
    window.dispatchEvent(new CustomEvent('fetchTerminalLog', { 
      detail: { jobId: jobIdToUse, logType: 'analyze' } 
    }));

    try {
      console.log('Calling /api/analyze with job_id:', jobIdToUse);
      const response = await axios.get('/api/analyze', {
        params: { job_id: jobIdToUse },
      });

      console.log('Analysis response:', response.data);
      const data = response.data;
      setAnalysisResult(data);
      setMdContent(data.md_content || '');
      console.log('Analysis complete, md_content length:', data.md_content?.length || 0);
      
      // Refresh job info after analysis
      if (jobIdToUse) {
        try {
          const jobResponse = await axios.get(`/api/jobs/${jobIdToUse}`);
          // Fetch terminal log after analysis completes
          window.dispatchEvent(new CustomEvent('fetchTerminalLog', { 
            detail: { jobId: jobIdToUse, logType: 'analyze' } 
          }));
          if (onAnalysisComplete) {
            onAnalysisComplete({ ...data, job: jobResponse.data });
          }
        } catch (err) {
          console.warn('Failed to refresh job after analysis:', err);
          // Still fetch terminal log even if job refresh fails
          window.dispatchEvent(new CustomEvent('fetchTerminalLog', { 
            detail: { jobId: jobIdToUse, logType: 'analyze' } 
          }));
          if (onAnalysisComplete) {
            onAnalysisComplete(data);
          }
        }
      } else if (onAnalysisComplete) {
        onAnalysisComplete(data);
      }
    } catch (err) {
      console.error('Analysis error:', err);
      let errorMsg = '';
      const isZh = (t.lang || 'en') === 'zh';
      
      if (err.response) {
        const status = err.response.status;
        const detail = err.response.data?.detail || err.response.statusText;
        errorMsg = isZh
          ? `分析失败 (HTTP ${status}): ${detail}`
          : `Analysis failed (HTTP ${status}): ${detail}`;
        console.error('Analysis failed with status:', status, 'detail:', detail);
      } else if (err.message) {
        errorMsg = err.message;
        console.error('Analysis failed with message:', err.message);
      } else {
        errorMsg = isZh ? '分析失败: ' + String(err) : 'Analysis failed: ' + String(err);
        console.error('Analysis failed:', err);
      }
      
      setError(errorMsg);
      
      // Fetch terminal log even on error to show what happened
      if (jobIdToUse) {
        window.dispatchEvent(new CustomEvent('fetchTerminalLog', { 
          detail: { jobId: jobIdToUse, logType: 'analyze' } 
        }));
      }
    } finally {
      console.log('Analysis finished, setting isAnalyzing to false');
      setIsAnalyzing(false);
    }
  };

  const startAnalysis = async () => {
    if (!jobId) {
      setError((t.lang || 'en') === 'zh' ? '缺少 Job ID' : 'Missing Job ID');
      return;
    }

    console.log('Starting analysis for jobId:', jobId);
    setIsAnalyzing(true);
    setError(null);
    setAnalysisResult(null);
    setMdContent('');

    try {
      console.log('Calling /api/analyze with job_id:', jobId);
      const response = await axios.get('/api/analyze', {
        params: { job_id: jobId },
      });

      console.log('Analysis response:', response.data);
      const data = response.data;
      setAnalysisResult(data);
      setMdContent(data.md_content || '');
      console.log('Analysis complete, md_content length:', data.md_content?.length || 0);
      
      // Refresh job info after analysis
      if (jobId) {
        try {
          const jobResponse = await axios.get(`/api/jobs/${jobId}`);
          if (onAnalysisComplete) {
            onAnalysisComplete({ ...data, job: jobResponse.data });
          }
        } catch (err) {
          console.warn('Failed to refresh job after analysis:', err);
          if (onAnalysisComplete) {
            onAnalysisComplete(data);
          }
        }
      } else if (onAnalysisComplete) {
        onAnalysisComplete(data);
      }
    } catch (err) {
      console.error('Analysis error:', err);
      let errorMsg = '';
      const isZh = (t.lang || 'en') === 'zh';
      
      if (err.response) {
        const status = err.response.status;
        const detail = err.response.data?.detail || err.response.statusText;
        errorMsg = isZh
          ? `分析失败 (HTTP ${status}): ${detail}`
          : `Analysis failed (HTTP ${status}): ${detail}`;
        console.error('Analysis failed with status:', status, 'detail:', detail);
      } else if (err.message) {
        errorMsg = err.message;
        console.error('Analysis failed with message:', err.message);
      } else {
        errorMsg = isZh ? '分析失败: ' + String(err) : 'Analysis failed: ' + String(err);
        console.error('Analysis failed:', err);
      }
      
      setError(errorMsg);
      
      // Fetch terminal log even on error to show what happened
      const effectiveJobId = jobId || localStorage.getItem('i2pptt_current_job_id');
      if (effectiveJobId) {
        window.dispatchEvent(new CustomEvent('fetchTerminalLog', { 
          detail: { jobId: effectiveJobId, logType: 'analyze' } 
        }));
      }
    } finally {
      console.log('Analysis finished, setting isAnalyzing to false');
      setIsAnalyzing(false);
    }
  };

  // Parse markdown to extract structure info
  const parseMarkdownStructure = (content) => {
    if (!content) return null;
    
    const lines = content.split('\n');
    const structure = {
      groups: [],
      images: [],
    };
    
    let currentGroup = null;
    let currentSubGroup = null;
    let currentSubSubGroup = null;
    let currentImage = null;
    let lineIndex = 0;
    
    for (lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      const trimmed = line.trim();
      
      // Level 1 group (#)
      if (trimmed.startsWith('# ') && !trimmed.startsWith('##')) {
        currentGroup = {
          name: trimmed.substring(2).trim(),
          level: 1,
          subgroups: [],
          images: [],
        };
        structure.groups.push(currentGroup);
        currentSubGroup = null;
        currentSubSubGroup = null;
        currentImage = null;
      }
      // Level 2 group (##)
      else if (trimmed.startsWith('## ') && !trimmed.startsWith('###')) {
        currentSubGroup = {
          name: trimmed.substring(3).trim(),
          level: 2,
          subsubgroups: [],
          images: [],
        };
        if (currentGroup) {
          currentGroup.subgroups.push(currentSubGroup);
        } else {
          structure.groups.push(currentSubGroup);
        }
        currentSubSubGroup = null;
        currentImage = null;
      }
      // Level 3 group (###)
      else if (trimmed.startsWith('### ')) {
        currentSubSubGroup = {
          name: trimmed.substring(4).trim(),
          level: 3,
          images: [],
        };
        if (currentSubGroup) {
          currentSubGroup.subsubgroups.push(currentSubSubGroup);
        } else if (currentGroup) {
          if (!currentGroup.subgroups) currentGroup.subgroups = [];
          currentGroup.subgroups.push(currentSubSubGroup);
        } else {
          structure.groups.push(currentSubSubGroup);
        }
        currentImage = null;
      }
      // Image entry (- path: ...)
      else if (trimmed.startsWith('- path:')) {
        currentImage = {
          path: trimmed.match(/path:\s*(.+)/)?.[1]?.trim() || '',
          filename: '',
          title: '',
          size: '',
          orientation: '',
        };
        
        // Look for more info in following lines (within same image block)
        for (let i = lineIndex + 1; i < lines.length && i < lineIndex + 10; i++) {
          const nextLine = lines[i];
          const nextTrimmed = nextLine.trim();
          
          if (nextTrimmed.startsWith('filename:')) {
            currentImage.filename = nextTrimmed.match(/filename:\s*(.+)/)?.[1]?.trim() || '';
          } else if (nextTrimmed.startsWith('title:')) {
            currentImage.title = nextTrimmed.match(/title:\s*(.+)/)?.[1]?.trim() || '';
          } else if (nextTrimmed.startsWith('size:')) {
            currentImage.size = nextTrimmed.match(/size:\s*(.+)/)?.[1]?.trim() || '';
          } else if (nextTrimmed.startsWith('orientation:')) {
            currentImage.orientation = nextTrimmed.match(/orientation:\s*(.+)/)?.[1]?.trim() || '';
          } else if (nextTrimmed.startsWith('-') || nextTrimmed.startsWith('#')) {
            break;
          }
        }
        
        // Add image to appropriate group
        if (currentSubSubGroup) {
          currentSubSubGroup.images.push(currentImage);
        } else if (currentSubGroup) {
          currentSubGroup.images.push(currentImage);
        } else if (currentGroup) {
          currentGroup.images.push(currentImage);
        } else {
          structure.images.push(currentImage);
        }
        
        currentImage = null;
      }
    }
    
    return structure;
  };

  const structure = parseMarkdownStructure(mdContent);

  const renderStructurePreview = () => {
    if (!structure || structure.groups.length === 0) {
      return (
        <div style={{ padding: '1rem', color: '#64748b' }}>
          {(t.lang || 'en') === 'zh' ? '无分组信息' : 'No group information'}
        </div>
      );
    }

    return (
      <div className="structure-preview">
        {structure.groups.map((group, idx) => (
          <div key={idx} className="structure-group">
            <div className="structure-group-header">
              <span className="structure-level-1"># {group.name}</span>
            </div>
            {group.subgroups && group.subgroups.length > 0 && (
              <div className="structure-subgroups">
                {group.subgroups.map((subgroup, subIdx) => (
                  <div key={subIdx} className="structure-subgroup">
                    <div className="structure-group-header">
                      <span className="structure-level-2">## {subgroup.name}</span>
                    </div>
                    {subgroup.subsubgroups && subgroup.subsubgroups.length > 0 && (
                      <div className="structure-subsubgroups">
                        {subgroup.subsubgroups.map((subsubgroup, subSubIdx) => (
                          <div key={subSubIdx} className="structure-subsubgroup">
                            <div className="structure-group-header">
                              <span className="structure-level-3">### {subsubgroup.name}</span>
                            </div>
                            {subsubgroup.images && subsubgroup.images.length > 0 && (
                              <div className="structure-images">
                                {subsubgroup.images.map((img, imgIdx) => (
                                  <div key={imgIdx} className="structure-image-item">
                                    <span className="image-filename">{img.filename || img.path}</span>
                                    {img.size && <span className="image-size">{img.size}</span>}
                                    {img.orientation && (
                                      <span className="image-orientation">{img.orientation}</span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {subgroup.images && subgroup.images.length > 0 && (
                      <div className="structure-images">
                        {subgroup.images.map((img, imgIdx) => (
                          <div key={imgIdx} className="structure-image-item">
                            <span className="image-filename">{img.filename || img.path}</span>
                            {img.size && <span className="image-size">{img.size}</span>}
                            {img.orientation && (
                              <span className="image-orientation">{img.orientation}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            {group.images && group.images.length > 0 && (
              <div className="structure-images">
                {group.images.map((img, imgIdx) => (
                  <div key={imgIdx} className="structure-image-item">
                    <span className="image-filename">{img.filename || img.path}</span>
                    {img.size && <span className="image-size">{img.size}</span>}
                    {img.orientation && (
                      <span className="image-orientation">{img.orientation}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="analyze-form">

      {isAnalyzing && (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <div style={{ marginBottom: '1rem' }}>{t.step2.analyzing}</div>
          <div className="progress-indicator">...</div>
        </div>
      )}

      {error && (
        <div style={{ padding: '1rem', background: '#fee2e2', color: '#991b1b', borderRadius: '0.5rem', marginBottom: '1rem' }}>
          <strong>{(t.lang || 'en') === 'zh' ? '错误' : 'Error'}:</strong> {error}
          <button
            onClick={startAnalysis}
            style={{ marginLeft: '1rem', padding: '0.5rem 1rem', background: '#dc2626', color: 'white', border: 'none', borderRadius: '0.25rem', cursor: 'pointer' }}
          >
            {(t.lang || 'en') === 'zh' ? '重试' : 'Retry'}
          </button>
        </div>
      )}

      {analysisResult && !isAnalyzing && (
        <div>
          {/* Tab navigation */}
          <div style={{ 
            marginBottom: '1rem',
            borderBottom: '2px solid #d9e2ec'
          }}>
            <div className="tab-navigation" style={{ 
              display: 'flex', 
              gap: 0,
              margin: 0,
              border: 0
            }}>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: 'transparent',
                  border: 0,
                  borderBottom: activeTab === 'preview' ? '2px solid #2563eb' : '2px solid transparent',
                  color: activeTab === 'preview' ? '#2563eb' : '#64748b',
                  fontWeight: activeTab === 'preview' ? 600 : 400,
                  cursor: 'pointer',
                  fontSize: '0.95rem',
                  marginBottom: '-2px',
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap'
                }}
              >
                {t.step2.previewTitle || 'Analysis Preview'}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('markdown')}
                style={{
                  padding: '0.75rem 1.5rem',
                  background: 'transparent',
                  border: 0,
                  borderBottom: activeTab === 'markdown' ? '2px solid #2563eb' : '2px solid transparent',
                  color: activeTab === 'markdown' ? '#2563eb' : '#64748b',
                  fontWeight: activeTab === 'markdown' ? 600 : 400,
                  cursor: 'pointer',
                  fontSize: '0.95rem',
                  marginBottom: '-2px',
                  transition: 'all 0.2s ease',
                  whiteSpace: 'nowrap'
                }}
              >
                {(t.lang || 'en') === 'zh' ? 'Markdown 内容' : 'Markdown Content'}
              </button>
            </div>
          </div>

          {/* Tab content */}
          {activeTab === 'preview' && (
            <div style={{ marginBottom: '1rem' }}>
              <div style={{ height: '450px', overflow: 'auto', border: '1px solid #d9e2ec', borderRadius: '0.5rem', padding: '1rem', background: '#f8fafc' }}>
                {renderStructurePreview()}
              </div>
            </div>
          )}

          {activeTab === 'markdown' && (
            <div style={{ marginBottom: '1rem' }}>
              <pre style={{ height: '450px', overflow: 'auto', border: '1px solid #d9e2ec', borderRadius: '0.5rem', padding: '1rem', background: '#f8fafc', fontSize: '0.85rem', lineHeight: '1.5' }}>
                {mdContent}
              </pre>
            </div>
          )}

          {onConfirm && (
            <div className="actions" style={{ marginTop: '1rem', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                className="secondary"
                onClick={() => {
                  localStorage.removeItem('i2pptt_current_job_id');
                  window.location.href = '/';
                }}
              >
                {(t.lang || 'en') === 'zh' ? '开始新任务 ⏎' : 'Start New Job ⏎'}
              </button>
              <button
                className="primary"
                onClick={() => {
                  if (onConfirm) {
                    onConfirm(analysisResult);
                  }
                }}
              >
                {t.step2.confirmAndNext} ▶
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

