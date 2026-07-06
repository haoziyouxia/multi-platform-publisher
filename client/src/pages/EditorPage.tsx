import { useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import api from '../services/api';
import PlatformSelector from '../components/PlatformSelector';
import PublishProgress from '../components/PublishProgress';

const EditorPage = () => {
  const [title, setTitle] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<any>(null);
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Image,
      Placeholder.configure({ placeholder: '开始写下你的内容...' }),
    ],
    content: '',
  });

  // 上传图片
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('images', files[i]);
    }

    try {
      const res = await api.post('/content/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const newImages = res.data.files.map((f: any) => f.url);
      setImages([...images, ...newImages]);
      
      // 在编辑器中插入图片
      newImages.forEach((url: string) => {
        editor?.chain().focus().setImage({ src: url }).run();
      });
    } catch (err) {
      alert('图片上传失败');
    }
  };

  // 执行发布
  const handlePublish = async () => {
    if (!title.trim()) {
      alert('请输入标题');
      return;
    }
    if (selectedPlatforms.length === 0) {
      alert('请至少选择一个平台');
      return;
    }

    setPublishing(true);
    setPublishResult(null);

    try {
      // 1. 创建内容
      const contentRes = await api.post('/content', {
        title,
        body: editor?.getHTML() || '',
        images: images.map(url => ({ url })),
      });

      // 2. 执行发布
      const publishRes = await api.post('/publish', {
        content_id: contentRes.data.id,
        platforms: selectedPlatforms,
      });

      setPublishResult(publishRes.data);
    } catch (err: any) {
      alert(err.response?.data?.error || '发布失败');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div>
      <h1 className="page-title">内容编辑</h1>

      {/* 标题输入 */}
      <input
        className="input"
        style={{ fontSize: 18, marginBottom: 16 }}
        placeholder="请输入标题..."
        value={title}
        onChange={e => setTitle(e.target.value)}
      />

      {/* 工具栏 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button
          className="btn btn-secondary"
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          B
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          I
        </button>
        <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
          📷 图片
          <input
            type="file"
            accept="image/jpeg,image/png,image/gif"
            multiple
            style={{ display: 'none' }}
            onChange={handleImageUpload}
          />
        </label>
      </div>

      {/* 编辑器 */}
      <div className="card" style={{ minHeight: 300, marginBottom: 20 }}>
        <EditorContent editor={editor} />
      </div>

      {/* 平台选择 */}
      <PlatformSelector
        selected={selectedPlatforms}
        onChange={setSelectedPlatforms}
      />

      {/* 发布按钮 */}
      <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
        <button
          className="btn btn-primary"
          onClick={handlePublish}
          disabled={publishing || !title.trim() || selectedPlatforms.length === 0}
        >
          {publishing ? '发布中...' : '发布'}
        </button>
      </div>

      {/* 发布进度 */}
      {publishResult && (
        <PublishProgress tasks={publishResult.tasks} />
      )}
    </div>
  );
};

export default EditorPage;
