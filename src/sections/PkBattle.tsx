import { useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import badgeVictoryUrl from '/badge-victory.png';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Pet } from '@/components/Pet';
import { TempGroupPK } from '@/sections/TempGroupPK';
import { useQuestionBank, type Question, type QuestionBank, type QuestionType } from '@/hooks/useQuestionBank';
import type { Student, PetType } from '@/types/pet';
import { getStageByExperience } from '@/types/pet';

interface PkBattleProps {
  students: Student[];
  petTypes: PetType[];
  onAddPoints?: (studentId: string, points: number) => void;
}

// ─────────────── 图片上传工具 ───────────────

// 压缩图片（保持原始分辨率，仅降低画质以减小体积）
// 输出格式：image/jpeg（比 png 小 5-10 倍），质量 0.6
async function compressImage(file: File, maxDimension = 1600): Promise<Blob> {
  return new Promise((res, rej) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);  // 释放内存
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        blob => {
          if (blob) res(blob);
          else rej(new Error('压缩失败'));
        },
        'image/jpeg',
        0.6,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      rej(new Error('图片加载失败'));
    };
    img.src = objectUrl;
  });
}

// base64 最大允许大小（~400KB base64 ≈ 300KB 图片）
const MAX_BASE64_SIZE = 400_000;

function imageFileToBase64(file: File): Promise<string> {
  return new Promise(async (res, rej) => {
    try {
      // 非图片文件或 gif 直接原样转换
      if (!file.type.startsWith('image/') || file.type === 'image/gif') {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          if (result.length > MAX_BASE64_SIZE) {
            rej(new Error('图片过大，请使用更小的图片'));
            return;
          }
          res(result);
        };
        reader.onerror = rej;
        reader.readAsDataURL(file);
        return;
      }
      // 压缩后再转 base64
      const compressedBlob = await compressImage(file);
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        if (result.length > MAX_BASE64_SIZE) {
          // 尺寸过大，用更小尺寸再压一次
          compressImage(file, 800).then(smallerBlob => {
            const r2 = new FileReader();
            r2.onload = () => res(r2.result as string);
            r2.onerror = rej;
            r2.readAsDataURL(smallerBlob);
          }).catch(() => {
            rej(new Error('图片过大，请使用更小的图片'));
          });
          return;
        }
        res(result);
      };
      reader.onerror = rej;
      reader.readAsDataURL(compressedBlob);
    } catch (e) {
      // 压缩失败，降级为原图
      console.warn('图片压缩失败，使用原图', e);
      const reader = new FileReader();
      reader.onload = () => res(reader.result as string);
      reader.onerror = rej;
      reader.readAsDataURL(file);
    }
  });
}

// 从粘贴事件提取图片（带压缩）
async function extractImageFromClipboard(e: React.ClipboardEvent): Promise<string | null> {
  const items = Array.from(e.clipboardData.items);
  const imgItem = items.find(it => it.type.startsWith('image/'));
  if (!imgItem) return null;
  const file = imgItem.getAsFile();
  if (!file) return null;
  // 粘贴的图片也走压缩流程
  return await imageFileToBase64(file);
}

// ─────────────── 多图片上传组件 ───────────────
function ImageUploader({
  values = [],
  onChange,
  label = '添加图片',
  maxImages = 5,
}: {
  values?: string[];
  onChange: (urls: string[]) => void;
  label?: string;
  maxImages?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList) => {
    const newUrls: string[] = [];
    for (let i = 0; i < files.length; i++) {
      if (values.length + newUrls.length >= maxImages) break;
      try {
        const b64 = await imageFileToBase64(files[i]);
        newUrls.push(b64);
      } catch (err: any) {
        toast.error(err?.message || '图片处理失败');
      }
    }
    if (newUrls.length) onChange([...values, ...newUrls]);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    try {
      const url = await extractImageFromClipboard(e);
      if (url && values.length < maxImages) onChange([...values, url]);
    } catch (err: any) {
      toast.error(err?.message || '图片粘贴失败');
    }
  };

  const removeImage = (idx: number) => {
    onChange(values.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      {/* 已添加的图片网格 */}
      {values.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {values.map((url, i) => (
            <div key={i} className="relative inline-block group">
              <img
                src={url}
                alt={`图片 ${i + 1}`}
                className="w-20 h-20 rounded-lg border object-cover"
              />
              <button
                type="button"
                className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-destructive text-white text-[10px] flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => removeImage(i)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      {/* 添加按钮 */}
      {values.length < maxImages && (
        <div
          className="border-2 border-dashed border-muted-foreground/30 rounded-lg p-3 text-center text-xs text-muted-foreground cursor-pointer hover:border-primary/40 hover:bg-muted/20 transition-all"
          onClick={() => inputRef.current?.click()}
          onPaste={handlePaste}
          tabIndex={0}
          onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
        >
          <div className="text-lg mb-0.5">🖼️</div>
          <p>{values.length > 0 ? `+ 添加更多 (${values.length}/${maxImages})` : label}</p>
          {values.length === 0 && <p className="text-[10px] mt-0.5 opacity-70">点击上传 或 Ctrl+V 粘贴</p>}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={e => {
          if (e.target.files?.length) handleFiles(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}

// ─────────────── 题目编辑弹窗 ───────────────
function QuestionEditor({
  open,
  initial,
  onSave,
  onClose,
}: {
  open: boolean;
  initial?: Partial<Question>;
  onSave: (q: Omit<Question, 'id'>) => void;
  onClose: () => void;
}) {
  const [type, setType] = useState<QuestionType>(initial?.type ?? 'short');
  const [content, setContent] = useState(initial?.content ?? '');
  const [options, setOptions] = useState<string[]>(
    initial?.options ?? ['A. ', 'B. ', 'C. ', 'D. ']
  );
  const [answer, setAnswer] = useState(initial?.answer ?? '');
  const [imageUrls, setImageUrls] = useState<string[]>(initial?.imageUrls ?? []);
  const [optionImages, setOptionImages] = useState<(string[] | undefined)[]>(
    initial?.optionImages ?? [undefined, undefined, undefined, undefined]
  );

  // 重置表单当 initial 变化
  useEffect(() => {
    if (open) {
      setType(initial?.type ?? 'short');
      setContent(initial?.content ?? '');
      setOptions(initial?.options ?? ['A. ', 'B. ', 'C. ', 'D. ']);
      setAnswer(initial?.answer ?? '');
      setImageUrls(initial?.imageUrls ?? []);
      setOptionImages(initial?.optionImages ?? [undefined, undefined, undefined, undefined]);
    }
  }, [open, initial]);

  const handleSave = () => {
    if (!content.trim()) return;
    const q: Omit<Question, 'id'> = {
      type,
      content: content.trim(),
      answer: answer.trim() || undefined,
      imageUrls: imageUrls.length ? imageUrls : undefined,
    };
    if (type === 'choice') {
      const validOptions = options.filter(o => o.trim().length > 2);
      q.options = validOptions.length >= 2 ? validOptions : undefined;
      const validOptionImages = optionImages.slice(0, options.length);
      if (validOptionImages.some(img => img && img.length > 0)) q.optionImages = validOptionImages;
    }
    onSave(q);
    onClose();
  };

  if (!open) return null;

  return (
    <AlertDialog open={open} onOpenChange={v => !v && onClose()}>
      <AlertDialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {initial?.id ? '✏️ 编辑题目' : '➕ 新建题目'}
          </AlertDialogTitle>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          {/* 题型 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">题目类型</Label>
            <div className="flex gap-2">
              {(['short', 'choice', 'truefalse'] as QuestionType[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${
                    type === t
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-background border-border hover:border-primary/50 text-foreground'
                  }`}
                >
                  {t === 'short' ? '💬 简答题' : t === 'choice' ? '📝 选择题' : '✅ 判断题'}
                </button>
              ))}
            </div>
          </div>

          {/* 题目正文 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">题目正文 *</Label>
            <textarea
              className="w-full h-24 text-sm border rounded-lg p-3 resize-y bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
              placeholder="请输入题目内容..."
              value={content}
              onChange={e => setContent(e.target.value)}
            />
          </div>

          {/* 题目图片 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">题目图片（可选，最多5张）</Label>
            <ImageUploader
              values={imageUrls}
              onChange={setImageUrls}
              label="为题目添加图片"
            />
          </div>

          {/* 选择题选项 */}
          {type === 'choice' && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">选项（至少保留2个）</Label>
              {options.map((opt, i) => (
                <div key={i} className="space-y-1.5 p-2 rounded-lg border border-border/40 bg-background/50">
                  <div className="flex gap-2 items-center">
                    <span className="w-6 text-sm text-muted-foreground font-mono shrink-0">
                      {String.fromCharCode(65 + i)}.
                    </span>
                    <Input
                      className="text-sm h-9 flex-1"
                      value={opt.replace(/^[ABCD][.、．]\s*/i, '')}
                      placeholder={`选项 ${String.fromCharCode(65 + i)}`}
                      onChange={e => {
                        const newOpts = [...options];
                        newOpts[i] = `${String.fromCharCode(65 + i)}. ${e.target.value}`;
                        setOptions(newOpts);
                      }}
                    />
                    {options.length > 2 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0 text-destructive/60 hover:text-destructive shrink-0"
                        onClick={() => {
                          setOptions(prev => prev.filter((_, idx) => idx !== i));
                          setOptionImages(prev => prev.filter((_, idx) => idx !== i));
                        }}
                      >×</Button>
                    )}
                  </div>
                  {/* 选项图片 */}
                  <div className="ml-8">
                    <ImageUploader
                      values={optionImages[i] ?? []}
                      onChange={urls => {
                        const newImgs = [...optionImages];
                        newImgs[i] = urls.length ? urls : undefined;
                        setOptionImages(newImgs);
                      }}
                      label={`选项${String.fromCharCode(65 + i)}图片`}
                    />
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setOptions(prev => [...prev, `${String.fromCharCode(65 + prev.length)}. `]);
                  setOptionImages(prev => [...prev, undefined]);
                }}
                disabled={options.length >= 6}
                className="text-xs"
              >
                + 添加选项
              </Button>
            </div>
          )}

          {/* 标准答案 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">标准答案（可选）</Label>
            <Input
              placeholder={
                type === 'choice' ? '如：A 或 B' :
                type === 'truefalse' ? '对 / 错' :
                '填写参考答案...'
              }
              value={answer}
              onChange={e => setAnswer(e.target.value)}
            />
          </div>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={onClose}>取消</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleSave}
            disabled={!content.trim()}
          >
            {initial?.id ? '保存修改' : '添加题目'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─────────────── 题库管理面板 ───────────────
function QuestionBankPanel({
  banks,
  onCreateBank,
  onDeleteBank,
  onRenameBank,
  onImport,
  onAddQuestion,
  onUpdateQuestion,
  onDeleteQuestion,
}: {
  banks: QuestionBank[];
  onCreateBank: (name: string) => void;
  onDeleteBank: (id: string) => void;
  onRenameBank: (id: string, name: string) => void;
  onImport: (bankId: string, text: string) => number;
  onAddQuestion: (bankId: string, q: Omit<Question, 'id'>) => void;
  onUpdateQuestion: (bankId: string, qId: string, updates: Partial<Omit<Question, 'id'>>) => void;
  onDeleteQuestion: (bankId: string, qId: string) => void;
}) {
  const [newBankName, setNewBankName] = useState('');
  const [selectedBank, setSelectedBank] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [editingName, setEditingName] = useState<{ id: string; value: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [showImportText, setShowImportText] = useState(false);
  const [wordImporting, setWordImporting] = useState(false);
  const [wordMsg, setWordMsg] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const wordInputRef = useRef<HTMLInputElement>(null);

  const bank = banks.find(b => b.id === selectedBank);

  const handleCreate = () => {
    if (!newBankName.trim()) return;
    onCreateBank(newBankName.trim());
    setNewBankName('');
  };

  const handleImportText = () => {
    if (!selectedBank || !importText.trim()) return;
    const count = onImport(selectedBank, importText);
    setImportMsg(`✅ 成功导入 ${count} 道题`);
    setImportText('');
    setShowImportText(false);
    setTimeout(() => setImportMsg(''), 3000);
  };

  // Word 文档导入
  const handleWordImport = async (file: File) => {
    if (!selectedBank) return;
    setWordImporting(true);
    setWordMsg('');
    try {
      const mammoth = await import('mammoth');
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      const text = result.value;
      if (!text.trim()) {
        setWordMsg('⚠️ 未能从文档中提取文字');
        return;
      }
      const count = onImport(selectedBank, text);
      setWordMsg(`✅ 从 Word 导入 ${count} 道题`);
      setTimeout(() => setWordMsg(''), 4000);
    } catch (err) {
      setWordMsg('❌ Word 解析失败，请检查文件格式');
    } finally {
      setWordImporting(false);
    }
  };

  const openNewQuestion = () => {
    setEditingQuestion(null);
    setEditorOpen(true);
  };

  const openEditQuestion = (q: Question) => {
    setEditingQuestion(q);
    setEditorOpen(true);
  };

  const handleSaveQuestion = (q: Omit<Question, 'id'>) => {
    if (!selectedBank) return;
    if (editingQuestion) {
      onUpdateQuestion(selectedBank, editingQuestion.id, q);
    } else {
      onAddQuestion(selectedBank, q);
    }
  };

  return (
    <div className="space-y-6">
      {/* 新建题库 */}
      <Card className="game-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-game text-primary">📚 新建题库</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="题库名称，如：语文期末复习"
              value={newBankName}
              onChange={e => setNewBankName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              className="game-input flex-1"
            />
            <button className="game-btn game-btn-yellow text-sm px-4" onClick={handleCreate} disabled={!newBankName.trim()}>
              创建
            </button>
          </div>
        </CardContent>
      </Card>

      {/* 题库列表 */}
      {banks.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">🗂️ 题库列表</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {banks.map(b => (
              <div
                key={b.id}
                className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-all ${
                  selectedBank === b.id
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:border-primary/40 hover:bg-muted/30'
                }`}
                onClick={() => setSelectedBank(selectedBank === b.id ? null : b.id)}
              >
                {editingName?.id === b.id ? (
                  <Input
                    className="h-7 text-sm flex-1"
                    value={editingName.value}
                    autoFocus
                    onClick={e => e.stopPropagation()}
                    onChange={e => setEditingName({ id: b.id, value: e.target.value })}
                    onBlur={() => {
                      if (editingName.value.trim()) onRenameBank(b.id, editingName.value);
                      setEditingName(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        if (editingName.value.trim()) onRenameBank(b.id, editingName.value);
                        setEditingName(null);
                      }
                      if (e.key === 'Escape') setEditingName(null);
                    }}
                  />
                ) : (
                  <span className="font-medium text-sm flex-1 truncate">{b.name}</span>
                )}
                <Badge variant="secondary" className="text-xs shrink-0">{b.questions.length} 题</Badge>
                <Button
                  size="sm" variant="ghost"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground shrink-0"
                  onClick={e => { e.stopPropagation(); setEditingName({ id: b.id, value: b.name }); }}
                >✏️</Button>
                <Button
                  size="sm" variant="ghost"
                  className="h-7 w-7 p-0 text-destructive/70 hover:text-destructive shrink-0"
                  onClick={e => { e.stopPropagation(); setConfirmDelete(b.id); }}
                >🗑️</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 选中题库的操作区 */}
      {selectedBank && bank && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">
                📝「{bank.name}」题目管理
              </CardTitle>
              <div className="flex items-center gap-2">
                {importMsg && (
                  <span className="text-sm text-green-600 font-medium">{importMsg}</span>
                )}
                {wordMsg && (
                  <span className={`text-sm font-medium ${wordMsg.startsWith('✅') ? 'text-green-600' : 'text-destructive'}`}>
                    {wordMsg}
                  </span>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* 操作按钮行 */}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={openNewQuestion} className="gap-1.5">
                ➕ 新建题目
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => setShowImportText(!showImportText)}
                className="gap-1.5"
              >
                📋 文字导入
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => wordInputRef.current?.click()}
                disabled={wordImporting}
                className="gap-1.5"
              >
                📄 {wordImporting ? '解析中...' : 'Word 导入'}
              </Button>
              <input
                ref={wordInputRef}
                type="file"
                accept=".docx,.doc"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) handleWordImport(f);
                  e.target.value = '';
                }}
              />
            </div>

            {/* 文字导入区 */}
            {showImportText && (
              <div className="space-y-2 p-3 bg-muted/30 rounded-lg border">
                <div className="text-xs text-muted-foreground space-y-1">
                  <p className="font-medium">📋 格式说明（每道题之间空一行）：</p>
                  <p>• <b>简答题</b>：直接输入题目即可</p>
                  <p>• <b>选择题</b>：题目正文后，每行 A. B. C. D. 开头</p>
                  <p>• <b>判断题</b>：题目正文含"对还是错"或"是否正确"</p>
                  <p>• 可在最后一行加 <b>答案：X</b></p>
                </div>
                <textarea
                  className="w-full h-36 text-sm border rounded-lg p-3 resize-y font-mono bg-background focus:outline-none focus:ring-2 focus:ring-primary/40"
                  placeholder={`光合作用的原料是什么？\n答案：水和二氧化碳\n\n下列哪项是植物光合作用的产物？\nA. 水\nB. 二氧化碳\nC. 氧气\nD. 氮气\n答案：C`}
                  value={importText}
                  onChange={e => setImportText(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleImportText} disabled={!importText.trim()}>
                    📥 导入
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowImportText(false); setImportText(''); }}>
                    取消
                  </Button>
                </div>
              </div>
            )}

            {/* 题目列表 */}
            {bank.questions.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-muted-foreground">
                  共 {bank.questions.length} 道题：
                </p>
                <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
                  {bank.questions.map((q, i) => (
                    <div
                      key={q.id}
                      className="flex items-start gap-2 p-2.5 rounded-lg bg-muted/30 border border-border/50 text-sm group"
                    >
                      <span className="text-muted-foreground shrink-0 w-6 text-right mt-0.5">
                        {i + 1}.
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 shrink-0">
                            {q.type === 'choice' ? '选择' : q.type === 'truefalse' ? '判断' : '简答'}
                          </Badge>
                          <span className="line-clamp-2 flex-1">{q.content}</span>
                          {q.imageUrls && q.imageUrls.length > 0 && <span className="text-xs text-primary shrink-0">🖼️×{q.imageUrls.length}</span>}
                        </div>
                        {q.answer && (
                          <span className="text-xs text-red-600 mt-0.5 block">
                            答：{q.answer}
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <Button
                          size="sm" variant="ghost"
                          className="h-6 w-6 p-0 text-primary/70 hover:text-primary"
                          onClick={() => openEditQuestion(q)}
                        >✏️</Button>
                        <Button
                          size="sm" variant="ghost"
                          className="h-6 w-6 p-0 text-destructive/50 hover:text-destructive"
                          onClick={() => onDeleteQuestion(bank.id, q.id)}
                        >×</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-sm text-muted-foreground">
                <div className="text-3xl mb-2">📭</div>
                暂无题目，点击上方按钮添加
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* 题目编辑弹窗 */}
      <QuestionEditor
        open={editorOpen}
        initial={editingQuestion ?? undefined}
        onSave={handleSaveQuestion}
        onClose={() => setEditorOpen(false)}
      />

      {/* 删除题库确认 */}
      <AlertDialog open={!!confirmDelete} onOpenChange={() => setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除题库？</AlertDialogTitle>
            <AlertDialogDescription>
              删除后题库中的所有题目将一并删除，不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (confirmDelete) {
                  if (selectedBank === confirmDelete) setSelectedBank(null);
                  onDeleteBank(confirmDelete);
                }
                setConfirmDelete(null);
              }}
            >确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────── 战斗者选择器 ───────────────
function FighterSelector({
  label,
  side,
  students,
  petTypes,
  selected,
  onSelect,
}: {
  label: string;
  side: 'left' | 'right';
  students: Student[];
  petTypes: PetType[];
  selected: Student | null;
  onSelect: (s: Student | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const filtered = students.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.nickname && s.nickname.toLowerCase().includes(search.toLowerCase()))
  );

  const petType = selected
    ? petTypes.find(p => p.id === selected.pet.petTypeId) || petTypes[0]
    : null;
  const stage = selected ? getStageByExperience(selected.pet.experience) : null;

  const borderColor = side === 'left' ? '#B84C4C' : '#3D7DCA';
  const gradient = side === 'left' ? 'from-red-50 to-rose-50' : 'from-blue-50 to-sky-50';
  const labelColor = side === 'left' ? 'text-red-700' : 'text-blue-700';

  return (
    <div
      className={`flex-1 flex flex-col items-center gap-3 p-4 rounded-2xl bg-gradient-to-b ${gradient} border-2`}
      style={{ borderColor }}
    >
      <div className={`text-sm font-bold ${labelColor} tracking-wider`}>{label}</div>

      {selected && petType && stage ? (
        <div className="flex flex-col items-center gap-1">
          <div className="font-bold text-lg">{selected.name}</div>
          <Pet petType={petType} stage={stage} experience={selected.pet.experience} size="lg" />
        </div>
      ) : (
        <div className="w-32 h-32 rounded-2xl border-2 border-dashed border-muted-foreground/30 flex flex-col items-center justify-center text-muted-foreground text-sm gap-2">
          <span className="text-3xl">❓</span>
          <span>选择学生</span>
        </div>
      )}

      <Button
        variant="outline" size="sm" className="w-full"
        style={{ borderColor, color: borderColor }}
        onClick={() => setOpen(true)}
      >
        {selected ? '换一个' : '选择学生'}
      </Button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>选择{label}的学生</AlertDialogTitle>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <Input
              placeholder="🔍 搜索姓名或昵称..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              autoFocus
            />
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {selected && (
                <button
                  className="w-full text-left p-2.5 rounded-lg text-sm text-muted-foreground hover:bg-muted/50 transition-colors"
                  onClick={() => { onSelect(null); setSearch(''); setOpen(false); }}
                >✖ 取消选择</button>
              )}
              {filtered.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-6">没有找到匹配的学生</p>
              ) : (
                filtered.map(s => {
                  const pt = petTypes.find(p => p.id === s.pet.petTypeId) || petTypes[0];
                  const st = getStageByExperience(s.pet.experience);
                  return (
                    <button
                      key={s.id}
                      className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left text-sm transition-all border ${
                        selected?.id === s.id
                          ? 'border-primary bg-primary/5 font-medium'
                          : 'border-transparent hover:border-border hover:bg-muted/30'
                      }`}
                      onClick={() => { onSelect(s); setSearch(''); setOpen(false); }}
                    >
                      <span className="text-xl">{pt.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{s.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {pt.stages[st]} · 经验 {s.pet.experience}
                        </div>
                      </div>
                      {selected?.id === s.id && <span className="text-primary">✓</span>}
                    </button>
                  );
                })
              )}
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSearch('')}>关闭</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─────────────── 图片灯箱 ───────────────
function ImageLightbox({
  src,
  onClose,
}: {
  src: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const imgRef = useRef<HTMLImageElement>(null);
  // baseSize: 图片在 zoom=1 时的实际渲染尺寸
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);

  // 图片加载完成后，记录基准尺寸（仅当尚未记录时）
  const handleImgLoad = useCallback(() => {
    if (imgRef.current && !baseSize) {
      const rect = imgRef.current.getBoundingClientRect();
      if (rect.width > 0) setBaseSize({ w: rect.width, h: rect.height });
    }
  }, [baseSize]);

  // src 变化时重置基准尺寸
  useEffect(() => { setBaseSize(null); }, [src]);

  // 如果图片已缓存，useEffect 中补测一次
  useEffect(() => {
    if (imgRef.current && imgRef.current.complete && !baseSize) {
      const rect = imgRef.current.getBoundingClientRect();
      if (rect.width > 0) setBaseSize({ w: rect.width, h: rect.height });
    }
  }, [src, baseSize]);

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)));
      }
      if (e.key === '-') {
        e.preventDefault();
        setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)));
      }
      if (e.key === '0') setZoom(1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // 计算放大后的显示尺寸
  const displayW = baseSize ? Math.round(baseSize.w * zoom) : undefined;
  const displayH = baseSize ? Math.round(baseSize.h * zoom) : undefined;

  const zoomIn  = () => setZoom(z => Math.min(3, +(z + 0.25).toFixed(2)));
  const zoomOut = () => setZoom(z => Math.max(0.25, +(z - 0.25).toFixed(2)));

  // 用 createPortal 渲染到 body，彻底脱离父容器的 stacking context
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* 缩放控制栏 - 底部中央 */}
      <div
        className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[10000] flex items-center gap-1
                   bg-black/70 backdrop-blur-sm rounded-full px-4 py-2 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-lg
                     hover:bg-white/20 transition-colors disabled:opacity-40"
          disabled={zoom <= 0.25}
          onClick={zoomOut}
        >−</button>
        <span className="text-white text-sm font-medium w-14 text-center tabular-nums select-none">
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="w-9 h-9 rounded-full flex items-center justify-center text-white text-lg
                     hover:bg-white/20 transition-colors disabled:opacity-40"
          disabled={zoom >= 3}
          onClick={zoomIn}
        >+</button>
        <span className="w-px h-5 bg-white/30 mx-1" />
        <button
          className="text-xs text-white/70 hover:text-white px-2 py-1 rounded hover:bg-white/10 transition-colors"
          onClick={() => setZoom(1)}
        >重置</button>
      </div>

      {/* 关闭按钮 */}
      <button
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/20 hover:bg-white/40
                   text-white text-xl flex items-center justify-center transition-colors z-[10000]"
        onClick={onClose}
      >×</button>

      {/* 图片容器 - 可滚动 */}
      <div
        className="overflow-auto rounded-xl"
        style={{ maxWidth: '96vw', maxHeight: '96vh' }}
        onClick={e => e.stopPropagation()}
      >
        <img
          ref={imgRef}
          src={src}
          alt="放大图片"
          onLoad={handleImgLoad}
          className={`rounded-xl shadow-2xl transition-[width,height] duration-100 ${
            baseSize ? '' : 'max-w-[96vw] max-h-[96vh] object-contain'
          }`}
          style={
            baseSize && displayW && displayH
              ? { width: `${displayW}px`, height: `${displayH}px`, objectFit: 'contain' }
              : undefined
          }
          onClick={e => e.stopPropagation()}
        />
        {/* 尺寸未测出前的占位 */}
        {!baseSize && (
          <div className="flex items-center justify-center" style={{ width: '96vw', height: '60vh' }}>
            <span className="text-white/60 text-sm">加载中…</span>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─────────────── 可点击放大图片 ───────────────
function ZoomableImage({ src, className = '' }: { src: string; className?: string }) {
  const [zoomed, setZoomed] = useState(false);
  return (
    <>
      <img
        src={src}
        alt="题目图片"
        className={`cursor-zoom-in rounded-lg border object-contain hover:shadow-md transition-shadow ${className}`}
        onClick={e => { e.stopPropagation(); setZoomed(true); }}
      />
      {zoomed && <ImageLightbox src={src} onClose={() => setZoomed(false)} />}
    </>
  );
}

// ─────────────── 题目展示区 ───────────────
function QuestionDisplay({ question }: { question: Question | null }) {
  const [showAnswer, setShowAnswer] = useState(false);

  useEffect(() => {
    setShowAnswer(false);
  }, [question]);

  if (!question) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 min-h-48">
        <div className="text-6xl opacity-30">⚔️</div>
        <p className="text-muted-foreground text-center text-sm">
          选好对战双方并选择题库<br />点击「出招」按钮开始随机抽题
        </p>
      </div>
    );
  }

  const typeLabel = {
    choice: '📝 选择题',
    truefalse: '✅ 判断题',
    short: '💬 简答题',
  }[question.type];

  return (
    <div className="flex-1 flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-2">
      <div className="flex justify-center sticky top-0 z-10 py-1">
        <Badge variant="secondary" className="text-xs px-3 py-1 shadow-sm">{typeLabel}</Badge>
      </div>

      <div className="bg-white rounded-2xl shadow-md border p-5 text-center">
        <p className="text-lg font-medium leading-relaxed">{question.content}</p>

        {/* 题目图片 */}
        {question.imageUrls && question.imageUrls.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 justify-center">
            {question.imageUrls.map((url, i) => (
              <ZoomableImage key={i} src={url} className="max-w-[200px] max-h-[200px]" />
            ))}
          </div>
        )}

        {/* 选择题选项 */}
        {question.options && question.options.length > 0 && (
          <div className="mt-4 grid grid-cols-1 gap-2 text-left">
            {question.options.map((opt, i) => (
              <div key={i} className="px-4 py-2 rounded-lg bg-muted/40 border border-border/50 text-sm hover:bg-muted/70 transition-colors">
                <div className="font-medium">{opt}</div>
                {question.optionImages?.[i] && question.optionImages[i]!.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {question.optionImages[i]!.map((url, j) => (
                      <ZoomableImage key={j} src={url} className="max-w-[120px] max-h-[120px]" />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* 判断题 */}
        {question.type === 'truefalse' && !question.options && (
          <div className="mt-4 flex justify-center gap-4">
            <span className="px-6 py-2 rounded-full bg-green-50 border border-green-200 text-green-700 text-sm font-medium">✓ 对</span>
            <span className="px-6 py-2 rounded-full bg-red-50 border border-red-200 text-red-700 text-sm font-medium">✗ 错</span>
          </div>
        )}
      </div>

      {question.answer && (
        <div className="flex flex-col items-center gap-2">
          {showAnswer ? (
            <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-3 text-center">
              <span className="text-xs text-red-600 font-medium block mb-1">参考答案</span>
              <span className="text-red-800 font-bold">{question.answer}</span>
            </div>
          ) : (
            <Button
              variant="outline" size="sm"
              className="text-red-600 border-red-300 hover:bg-red-50"
              onClick={() => setShowAnswer(true)}
            >👁️ 显示答案</Button>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────── 出招按钮 ───────────────
function AttackButton({
  label, disabled, color, onAttack,
}: {
  label: string;
  disabled: boolean;
  color: string;
  onAttack: () => void;
}) {
  const [shaking, setShaking] = useState(false);

  const handleClick = () => {
    if (disabled) return;
    setShaking(true);
    setTimeout(() => setShaking(false), 600);
    onAttack();
  };

  return (
    <button
      disabled={disabled}
      onClick={handleClick}
      className={`w-full py-3 rounded-xl font-bold text-white text-base shadow-lg transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed ${shaking ? 'animate-bounce' : ''}`}
      style={{
        background: disabled ? '#9CA3AF' : `linear-gradient(135deg, ${color}, ${color}cc)`,
        boxShadow: disabled ? 'none' : `0 4px 16px ${color}50`,
      }}
    >
      ⚡ {label}出招！
    </button>
  );
}

// ─────────────── 获胜按钮 ───────────────
function WinButton({
  label, disabled, color, onWin,
}: {
  label: string;
  disabled: boolean;
  color: string;
  onWin: () => void;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onWin}
      className="w-full py-2.5 rounded-xl font-bold text-base shadow transition-all duration-200 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed border-2"
      style={{
        borderColor: disabled ? '#D1D5DB' : color,
        color: disabled ? '#9CA3AF' : color,
        background: disabled ? 'transparent' : `${color}15`,
      }}
    >
      🏆 {label}获胜！
    </button>
  );
}

// ─────────────── 胜利界面 ───────────────
function VictoryScreen({
  winner,
  petType,
  onDismiss,
}: {
  winner: Student;
  petType: PetType;
  onDismiss: () => void;
}) {
  const stage = getStageByExperience(winner.pet.experience);

  // 烟花粒子
  const particles = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    delay: Math.random() * 1.5,
    size: 8 + Math.random() * 16,
    color: ['#D4A017', '#B84C4C', '#FFD700', '#FF6347', '#FFF8DC', '#FFA500'][Math.floor(Math.random() * 6)],
  }));

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      {/* 烟花粒子 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {particles.map(p => (
          <div
            key={p.id}
            className="absolute rounded-full animate-ping"
            style={{
              left: `${p.x}%`,
              top: `${p.y}%`,
              width: p.size,
              height: p.size,
              background: p.color,
              animationDelay: `${p.delay}s`,
              animationDuration: '1.5s',
              opacity: 0.8,
            }}
          />
        ))}
      </div>

      {/* 光晕背景 */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 50% 40%, rgba(212,160,23,0.18) 0%, transparent 65%)',
        }}
      />

      {/* 胜利卡片 */}
      <div
        className="relative z-10 rounded-3xl shadow-2xl p-8 flex flex-col items-center gap-5 max-w-sm w-full mx-4"
        style={{
          background: 'linear-gradient(160deg, #1A0A0A 0%, #2C1010 50%, #1A0A0A 100%)',
          border: '3px solid var(--color-accent)',
          boxShadow: '0 0 80px rgba(212,160,23,0.5), 0 0 20px rgba(212,160,23,0.3), 0 20px 60px rgba(0,0,0,0.5)',
        }}
      >
        {/* 顶部装饰线 */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 px-4 py-1 rounded-full text-xs font-black tracking-widest"
          style={{ background: 'var(--color-accent)', color: '#5C3A00' }}>
          ★ VICTORY ★
        </div>

        {/* 徽章图片 */}
        <div className="relative flex items-center justify-center">
          <div
            className="absolute rounded-full blur-3xl"
            style={{ width: 120, height: 120, background: 'radial-gradient(circle, var(--color-accent) 0%, transparent 70%)', opacity: 0.6 }}
          />
          <img
            src={badgeVictoryUrl}
            alt="胜利徽章"
            className="relative z-10 animate-bounce"
            style={{ width: 96, height: 96, filter: 'drop-shadow(0 0 16px var(--color-accent))' }}
          />
        </div>

        {/* 胜利文字 */}
        <div className="text-center space-y-1">
          <div
            className="text-4xl font-black tracking-wider"
            style={{
              background: 'linear-gradient(135deg, var(--color-accent), var(--color-primary))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              textShadow: 'none',
              filter: 'drop-shadow(0 2px 8px rgba(212,160,23,0.6))',
            }}
          >
            胜利！
          </div>
          <div className="text-2xl font-black text-white tracking-wide">{winner.name}</div>
          <div className="text-xs text-yellow-300/70 tracking-widest">的宝可梦赢得了对战！</div>
        </div>

        {/* 宠物 */}
        <div className="relative">
          <div
            className="absolute inset-0 rounded-full blur-2xl opacity-60"
            style={{ background: petType.color }}
          />
          <Pet
            petType={petType}
            stage={stage}
            experience={winner.pet.experience}
            size="lg"
          />
        </div>

        {/* +10 经验提示 */}
        <div className="flex items-center gap-3 rounded-2xl px-5 py-3 w-full justify-center"
          style={{ background: 'rgba(212,160,23,0.12)', border: '1px solid rgba(212,160,23,0.3)' }}>
          <span className="text-2xl">⭐</span>
          <div className="text-center">
            <div className="font-black text-yellow-300 text-lg">+10 经验值</div>
            <div className="text-xs text-yellow-400/60">战斗奖励已获得</div>
          </div>
        </div>

        <Button
          size="lg"
          className="w-full text-base font-black rounded-xl tracking-wide"
          style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-dark))', color: '#FFF8DC', border: 'none' }}
          onClick={onDismiss}
        >
          ⚔️ 继续对战
        </Button>
      </div>
    </div>,
    document.body
  );
}

// ─────────────── 主页面 ───────────────
export function PkBattle({ students, petTypes, onAddPoints }: PkBattleProps) {
  const {
    banks,
    saveError,
    createBank,
    deleteBank,
    renameBank,
    importQuestions,
    addQuestion,
    updateQuestion,
    deleteQuestion,
    pickRandom,
  } = useQuestionBank();

  // 题库保存失败时提示用户
  useEffect(() => {
    if (saveError) {
      toast.error(saveError, { duration: 6000 });
    }
  }, [saveError]);

  const [tab, setTab] = useState<'battle' | 'banks' | 'temp'>('battle');
  const [leftStudent, setLeftStudent] = useState<Student | null>(null);
  const [rightStudent, setRightStudent] = useState<Student | null>(null);
  const [selectedBankId, setSelectedBankId] = useState<string>('');
  const [currentQuestion, setCurrentQuestion] = useState<Question | null>(null);
  const [questionKey, setQuestionKey] = useState(0);
  const [winner, setWinner] = useState<Student | null>(null);

  const bankExists = banks.some(b => b.id === selectedBankId);

  const handleAttack = useCallback(() => {
    if (!selectedBankId || !bankExists) return;
    const q = pickRandom(selectedBankId);
    setCurrentQuestion(q);
    setQuestionKey(k => k + 1);
  }, [selectedBankId, bankExists, pickRandom]);

  const handleWin = useCallback((side: 'left' | 'right') => {
    const winnerStudent = side === 'left' ? leftStudent : rightStudent;
    if (!winnerStudent) return;
    // 加 10 经验
    if (onAddPoints) {
      onAddPoints(winnerStudent.id, 10);
    }
    // 清空题目，展示胜利界面
    setCurrentQuestion(null);
    setWinner(winnerStudent);
  }, [leftStudent, rightStudent, onAddPoints]);

  const handleDismissVictory = () => {
    setWinner(null);
  };

  const canAttack = !!selectedBankId && bankExists
    && (banks.find(b => b.id === selectedBankId)?.questions.length ?? 0) > 0;

  const winnerPetType = winner
    ? petTypes.find(p => p.id === winner.pet.petTypeId) || petTypes[0]
    : null;

  return (
    <div className="space-y-4">
      {/* 胜利界面 */}
      {winner && winnerPetType && (
        <VictoryScreen
          winner={winner}
          petType={winnerPetType}
          onDismiss={handleDismissVictory}
        />
      )}

      {/* 顶部 Tab */}
      <div className="flex gap-2 bg-muted/50 p-1 rounded-xl w-fit">
        <button
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'battle' ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('battle')}
        >⚔️ PK 对战</button>
        <button
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'banks' ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('banks')}
        >📚 题库管理</button>
        <button
          className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === 'temp' ? 'bg-white shadow text-foreground' : 'text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setTab('temp')}
        >🎯 临时分组</button>
        {banks.length > 0 && (
          <Badge variant="secondary" className="self-center text-xs">
            {banks.length} 个题库
          </Badge>
        )}
      </div>

      {/* 题库管理 */}
      {tab === 'banks' && (
        <QuestionBankPanel
          banks={banks}
          onCreateBank={createBank}
          onDeleteBank={deleteBank}
          onRenameBank={renameBank}
          onImport={importQuestions}
          onAddQuestion={addQuestion}
          onUpdateQuestion={updateQuestion}
          onDeleteQuestion={deleteQuestion}
        />
      )}

      {/* 临时分组 PK */}
      {tab === 'temp' && (
        <TempGroupPK students={students} petTypes={petTypes} onAddPoints={onAddPoints} />
      )}

      {/* PK 对战页面 */}
      {tab === 'battle' && (
        <div className="space-y-4">
          {/* 题库选择 */}
          <Card>
            <CardContent className="py-3">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium text-muted-foreground shrink-0">📚 选择题库：</span>
                {banks.length === 0 ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">还没有题库，</span>
                    <button className="text-sm text-primary underline hover:no-underline" onClick={() => setTab('banks')}>
                      去创建一个
                    </button>
                  </div>
                ) : (
                  <Select value={selectedBankId} onValueChange={setSelectedBankId}>
                    <SelectTrigger className="w-56">
                      <SelectValue placeholder="请选择题库..." />
                    </SelectTrigger>
                    <SelectContent>
                      {banks.map(b => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                          <span className="text-muted-foreground ml-2 text-xs">({b.questions.length} 题)</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {selectedBankId && bankExists && (
                  <Badge variant="outline" className="text-xs">
                    {banks.find(b => b.id === selectedBankId)?.questions.length ?? 0} 道题
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>

          {/* 主对战区域 · 道馆竞技场 */}
          <div
            className="flex gap-4 items-stretch min-h-[500px] rounded-2xl p-4 relative overflow-hidden"
            style={{
              background: 'linear-gradient(170deg, #EDE8DE 0%, #E3DDD0 35%, #D9D2C3 65%, #CFC8B8 100%)',
              boxShadow: 'inset 0 0 0 4px rgba(161,140,110,0.4), inset 0 0 0 1px rgba(0,0,0,0.06), 0 4px 24px rgba(0,0,0,0.08)',
            }}
          >
            {/* 地板纹理：细木纹 */ }
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                opacity: 0.25,
                backgroundImage: `
                  repeating-linear-gradient(0deg, transparent, transparent 18px, rgba(180,165,140,0.4) 18px, rgba(180,165,140,0.4) 19px),
                  repeating-linear-gradient(90deg, transparent, transparent 120px, rgba(180,165,140,0.2) 120px, rgba(180,165,140,0.2) 121px)
                `,
              }}
            />

            {/* 精灵球底纹：平铺小精灵球 */ }
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                opacity: 0.10,
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 80 80'%3E%3Ccircle cx='40' cy='40' r='28' fill='none' stroke='%23996633' stroke-width='1.5' opacity='0.6'/%3E%3Cpath d='M40 12 A28 28 0 0 1 68 40' fill='none' stroke='%23CC3333' stroke-width='1.5' opacity='0.5'/%3E%3Cpath d='M40 68 A28 28 0 0 1 12 40' fill='none' stroke='%23999999' stroke-width='1.5' opacity='0.5'/%3E%3Cline x1='4' y1='40' x2='76' y2='40' stroke='%23666666' stroke-width='2' opacity='0.35'/%3E%3Ccircle cx='40' cy='40' r='5' fill='%23999999' opacity='0.3' stroke='%23666666' stroke-width='1' opacity='0.35'/%3E%3Ccircle cx='40' cy='40' r='2.5' fill='%23DDDDDD' opacity='0.5'/%3E%3C/svg%3E")`,
                backgroundSize: '100px 100px',
              }}
            />

            {/* 场地边界线 · 外框 */ }
            <div
              className="absolute inset-3 pointer-events-none rounded-xl"
              style={{
                border: '2px solid rgba(161,140,110,0.4)',
              }}
            />
            {/* 场地边界线 · 内框 */ }
            <div
              className="absolute inset-6 pointer-events-none rounded-lg"
              style={{
                border: '1.5px dashed rgba(161,140,110,0.3)',
              }}
            />

            {/* 中线 */ }
            <div
              className="absolute left-1/2 top-3 bottom-3 w-[2px] pointer-events-none"
              style={{
                background: 'linear-gradient(to bottom, transparent 0%, rgba(161,140,110,0.35) 15%, rgba(161,140,110,0.35) 85%, transparent 100%)',
              }}
            />

            {/* 中心圆 */ }
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              style={{
                width: 160,
                height: 160,
                borderRadius: '50%',
                border: '2px solid rgba(161,140,110,0.35)',
                background: 'radial-gradient(circle, rgba(161,140,110,0.06) 0%, transparent 55%)',
              }}
            />

            {/* 中央精灵球 · 场地标志 */ }
            <svg
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
              width="100"
              height="100"
              viewBox="0 0 100 100"
              style={{ opacity: 0.35 }}
            >
              {/* 上半球 · 红 */ }
              <path d="M50 5 A45 45 0 0 1 95 50" fill="none" stroke="#CC3333" strokeWidth="3.5" opacity="0.8" />
              <clipPath id="pkball-top-clip">
                <rect x="0" y="0" width="100" height="50" />
              </clipPath>
              <circle cx="50" cy="50" r="43" fill="#CC3333" fillOpacity="0.15" clipPath="url(#pkball-top-clip)" />
              {/* 下半球 · 白 */ }
              <path d="M50 95 A45 45 0 0 1 5 50" fill="none" stroke="#BBBBBB" strokeWidth="3.5" opacity="0.7" />
              <clipPath id="pkball-bottom-clip">
                <rect x="0" y="50" width="100" height="50" />
              </clipPath>
              <circle cx="50" cy="50" r="43" fill="#CCCCCC" fillOpacity="0.2" clipPath="url(#pkball-bottom-clip)" />
              {/* 外圈 */ }
              <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(100,80,60,0.3)" strokeWidth="2" />
              {/* 中轴线 */ }
              <line x1="2" y1="50" x2="98" y2="50" stroke="rgba(80,60,40,0.35)" strokeWidth="3.5" />
              <line x1="2" y1="50" x2="98" y2="50" stroke="rgba(180,160,140,0.3)" strokeWidth="1" />
              {/* 中心按钮 */ }
              <circle cx="50" cy="50" r="8" fill="rgba(200,190,175,0.6)" stroke="rgba(100,80,60,0.25)" strokeWidth="2" />
              <circle cx="50" cy="50" r="4" fill="rgba(220,215,205,0.8)" />
            </svg>

            {/* 左侧训练师站台区 */ }
            <div
              className="absolute left-0 top-0 bottom-0 w-[260px] pointer-events-none rounded-l-2xl"
              style={{
                background: 'linear-gradient(90deg, rgba(184,76,76,0.15) 0%, rgba(184,76,76,0.04) 60%, transparent 100%)',
                borderRight: '1px solid rgba(184,76,76,0.12)',
              }}
            />
            {/* 右侧训练师站台区 */ }
            <div
              className="absolute right-0 top-0 bottom-0 w-[260px] pointer-events-none rounded-r-2xl"
              style={{
                background: 'linear-gradient(270deg, rgba(61,125,202,0.15) 0%, rgba(61,125,202,0.04) 60%, transparent 100%)',
                borderLeft: '1px solid rgba(61,125,202,0.12)',
              }}
            />

            {/* 左训练师站立点 */ }
            <div
              className="absolute left-[80px] top-1/2 -translate-y-1/2 pointer-events-none"
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'rgba(184,76,76,0.25)',
                boxShadow: '0 0 0 4px rgba(184,76,76,0.15), inset 0 2px 4px rgba(0,0,0,0.08)',
              }}
            />
            {/* 右训练师站立点 */ }
            <div
              className="absolute right-[80px] top-1/2 -translate-y-1/2 pointer-events-none"
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                background: 'rgba(61,125,202,0.25)',
                boxShadow: '0 0 0 4px rgba(61,125,202,0.15), inset 0 2px 4px rgba(0,0,0,0.08)',
              }}
            />

            {/* 左侧选手 */}
            <div className="w-56 shrink-0 flex flex-col gap-3 relative z-10">
              <FighterSelector
                label="🔴 左方选手"
                side="left"
                students={students}
                petTypes={petTypes}
                selected={leftStudent}
                onSelect={setLeftStudent}
              />
              <AttackButton
                label={leftStudent ? leftStudent.name : '左方'}
                disabled={!canAttack || !leftStudent}
                color="#B84C4C"
                onAttack={handleAttack}
              />
              <WinButton
                label={leftStudent ? leftStudent.name : '左方'}
                disabled={!leftStudent}
                color="#B84C4C"
                onWin={() => handleWin('left')}
              />
            </div>

            {/* 中间题目区 */}
            <div className="flex-1 flex flex-col relative z-10">
              {/* VS 标志 */}
              <div className="flex items-center justify-center mb-3 relative">
                <div className="flex items-center gap-1 px-4 py-1 rounded-full"
                  style={{ background: 'rgba(200,190,175,0.5)', backdropFilter: 'blur(4px)' }}>
                  <span className="text-amber-500 text-lg animate-pulse">⚡</span>
                  <div
                    className="text-3xl font-black tracking-widest"
                    style={{
                      background: 'linear-gradient(135deg, var(--color-accent), var(--color-primary), var(--color-primary-dark))',
                      WebkitBackgroundClip: 'text',
                      WebkitTextFillColor: 'transparent',
                      textShadow: 'none',
                      filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.15))',
                    }}
                  >VS</div>
                  <span className="text-amber-500 text-lg animate-pulse" style={{ animationDelay: '0.5s' }}>⚡</span>
                </div>
              </div>

              {/* 题目展示区 */}
              <div
                className="flex-1 rounded-2xl p-6 flex flex-col"
                style={{
                  background: 'var(--color-card-bg)',
                  border: '2px solid var(--color-accent-soft)',
                }}
              >
                <QuestionDisplay key={questionKey} question={currentQuestion} />
              </div>
              {canAttack && (leftStudent || rightStudent) && !currentQuestion && (
                <p className="text-center text-xs mt-2" style={{ color: 'rgba(120,100,75,0.6)' }}>
                  点击下方「出招」按钮随机抽题
                </p>
              )}
            </div>

            {/* 右侧选手 */}
            <div className="w-56 shrink-0 flex flex-col gap-3 relative z-10">
              <FighterSelector
                label="🔵 右方选手"
                side="right"
                students={students}
                petTypes={petTypes}
                selected={rightStudent}
                onSelect={setRightStudent}
              />
              <AttackButton
                label={rightStudent ? rightStudent.name : '右方'}
                disabled={!canAttack || !rightStudent}
                color="#3D7DCA"
                onAttack={handleAttack}
              />
              <WinButton
                label={rightStudent ? rightStudent.name : '右方'}
                disabled={!rightStudent}
                color="#3D7DCA"
                onWin={() => handleWin('right')}
              />
            </div>
          </div>

          {students.length === 0 && (
            <Card className="border-red-200 bg-red-50">
              <CardContent className="py-4 text-center text-red-700 text-sm">
                💡 还没有学生数据，请先在「学生管理」页面导入学生
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
