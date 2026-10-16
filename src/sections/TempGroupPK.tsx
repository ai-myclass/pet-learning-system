import { useState, useEffect, useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import {
  Shuffle, RefreshCw, RotateCcw, Trash2, Swords, Plus, Trophy, Download, Users,
} from 'lucide-react';
import type { Student, PetType } from '@/types/pet';

/* ───────────────────────────────────────────────────────────
   临时分组 PK
   - 导入姓名 → 随机/手动分成 2-4 组
   - 实时加分：给整组加（每人同加）或给个人加
   - 匹配到系统学员的会真实加经验值并持久化；未匹配的仅计分
   - 会话数据存 localStorage（刷新不丢），但不参与 GitHub 同步
   ─────────────────────────────────────────────────────────── */

const STORAGE_KEY = 'pet-learning-system-temp-pk';

const GROUP_COLORS = ['#EF4444', '#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899'];
const GROUP_NAMES = ['红组', '蓝组', '绿组', '黄组', '紫组', '粉组'];
const QUICK_POINTS = [1, 5, 10];

interface Participant {
  key: string;          // 唯一键（学生 id 或 guest_姓名）
  name: string;
  studentId?: string;   // 匹配到系统学员时存在
}

interface TempGroup {
  id: string;
  name: string;
  color: string;
  members: Participant[];
}

interface TempSession {
  groups: TempGroup[];
  points: Record<string, number>; // participant.key → 本场得分
  createdAt: number;
}

interface TempGroupPKProps {
  students: Student[];
  petTypes: PetType[];
  onAddPoints?: (studentId: string, points: number) => void;
}

/* 解析姓名：支持换行 / 逗号（中英）/ 顿号 / 分号 / 竖线 / 空白分隔，并去掉 "1." "1、" 等序号 */
function parseNames(text: string): string[] {
  return text
    .split(/[\s,，、;；|]+/)
    .map(s => s.replace(/^\d+[.、．)）:：]\s*/, '').trim())
    .filter(Boolean);
}

/* 洗牌 */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function TempGroupPK({ students, petTypes, onAddPoints }: TempGroupPKProps) {
  const [session, setSession] = useState<TempSession | null>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && Array.isArray(p.groups)) return p as TempSession;
      }
    } catch { /* 忽略损坏数据 */ }
    return null;
  });

  const [importText, setImportText] = useState('');
  const [groupCount, setGroupCount] = useState(2);
  const [customValue, setCustomValue] = useState(1);
  const [moveMenuFor, setMoveMenuFor] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [addInputs, setAddInputs] = useState<Record<string, string>>({});

  /* 持久化到 localStorage（跳过首次，避免无谓写入） */
  const firstRun = useRef(true);
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    try {
      if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* 存储失败不阻塞 */ }
  }, [session]);

  /* 姓名 → 学生（含昵称） */
  const findStudent = (name: string): Student | undefined => {
    const n = name.trim();
    return students.find(s => s.name === n)
      || students.find(s => s.nickname && s.nickname === n);
  };

  const petOf = (studentId?: string): PetType | undefined => {
    if (!studentId) return undefined;
    const s = students.find(st => st.id === studentId);
    if (!s) return undefined;
    return petTypes.find(p => p.id === s.pet.petTypeId);
  };

  /* 每组平均分（未分小组成员时计 0） */
  const groupScore = (g: TempGroup): number =>
    g.members.length > 0
      ? g.members.reduce((sum, m) => sum + (session?.points[m.key] || 0), 0) / g.members.length
      : 0;

  const ranked = useMemo(() => {
    if (!session) return [];
    const rows = session.groups.map(g => ({ group: g, score: groupScore(g) }));
    const max = Math.max(0, ...rows.map(r => r.score));
    const leaders = rows.filter(r => r.score === max && max > 0);
    return rows.map(r => ({ ...r, isLeader: leaders.length === 1 && r.score === max }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  /* ── 导入并随机分组 ── */
  const handleImport = () => {
    const names = parseNames(importText);
    if (names.length < 2) {
      toast.error('至少需要 2 个姓名才能分组对战');
      return;
    }
    const unique = Array.from(new Set(names));
    const participants: Participant[] = [];
    const unmatched: string[] = [];
    unique.forEach(name => {
      const s = findStudent(name);
      if (s) participants.push({ key: s.id, name: s.name, studentId: s.id });
      else { participants.push({ key: `guest_${name}`, name }); unmatched.push(name); }
    });

    const shuffled = shuffle(participants);
    const groups: TempGroup[] = Array.from({ length: groupCount }, (_, i) => ({
      id: `g${i}_${Date.now().toString(36)}${i}`,
      name: GROUP_NAMES[i] || `第${i + 1}组`,
      color: GROUP_COLORS[i % GROUP_COLORS.length],
      members: [],
    }));
    shuffled.forEach((p, i) => groups[i % groupCount].members.push(p));

    setSession({ groups, points: {}, createdAt: Date.now() });
    setImportText('');
    toast.success(`已导入 ${unique.length} 人，随机分为 ${groupCount} 组`, {
      description: unmatched.length
        ? `${unmatched.length} 人未匹配到系统学员（仅计分、不加经验）：${unmatched.slice(0, 6).join('、')}${unmatched.length > 6 ? '…' : ''}`
        : undefined,
    });
  };

  /* ── 重新随机分组（保留组名/颜色/数量，重置比分）── */
  const handleReshuffle = () => {
    if (!session) return;
    const all = session.groups.flatMap(g => g.members);
    const count = session.groups.length;
    const shuffled = shuffle(all);
    const groups = session.groups.map(g => ({ ...g, members: [] as Participant[] }));
    shuffled.forEach((p, i) => groups[i % count].members.push(p));
    setSession({ ...session, groups, points: {} });
    toast.success('已重新随机分组，比分已重置');
  };

  /* ── 给整组加分（每人同加 value）── */
  const addToGroup = (g: TempGroup, value: number) => {
    if (value <= 0 || g.members.length === 0) return;
    setSession(prev => {
      if (!prev) return prev;
      const points = { ...prev.points };
      g.members.forEach(m => { points[m.key] = (points[m.key] || 0) + value; });
      return { ...prev, points };
    });
    g.members.forEach(m => { if (m.studentId) onAddPoints?.(m.studentId, value); });
  };

  /* ── 给个人加分 ── */
  const addToMember = (m: Participant, value: number) => {
    if (value <= 0) return;
    setSession(prev => prev
      ? { ...prev, points: { ...prev.points, [m.key]: (prev.points[m.key] || 0) + value } }
      : prev);
    if (m.studentId) onAddPoints?.(m.studentId, value);
  };

  /* ── 给某个小组加人（输入姓名，自动匹配系统学员；重名拦截）── */
  const addMemberToGroup = (group: TempGroup, rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    const existing = session?.groups.find(g => g.members.some(m => m.name === name));
    if (existing) { toast.error(`「${name}」已在「${existing.name}」`); return; }
    const s = findStudent(name);
    const participant: Participant = s
      ? { key: s.id, name: s.name, studentId: s.id }
      : { key: `guest_${name}`, name };
    setSession(prev => prev
      ? { ...prev, groups: prev.groups.map(g => g.id === group.id ? { ...g, members: [...g.members, participant] } : g) }
      : prev);
    setAddInputs(prev => ({ ...prev, [group.id]: '' }));
    toast.success(`已将「${name}」加入${group.name}${s ? '' : '（来宾）'}`);
  };

  /* ── 移动成员到别的组 ── */
  const moveMember = (key: string, toGroupId: string) => {
    setMoveMenuFor(null);
    setSession(prev => {
      if (!prev) return prev;
      let moving: Participant | undefined;
      const groups = prev.groups.map(g => {
        const found = g.members.find(m => m.key === key);
        if (found) { moving = found; return { ...g, members: g.members.filter(m => m.key !== key) }; }
        return g;
      });
      if (!moving) return prev;
      const mv = moving;
      return { ...prev, groups: groups.map(g => g.id === toGroupId ? { ...g, members: [...g.members, mv] } : g) };
    });
  };

  /* ── 重置比分 ── */
  const handleResetScores = () => {
    setSession(prev => prev ? { ...prev, points: {} } : prev);
    setConfirmReset(false);
    toast.success('比分已重置');
  };

  /* ── 解散分组 ── */
  const handleClear = () => {
    setSession(null);
    setConfirmClear(false);
    toast.success('已解散临时分组');
  };

  /* ── 导出本场战绩 CSV ── */
  const handleExport = () => {
    if (!session) return;
    const rows: string[][] = [['组别', '姓名', '本场得分', '系统学员']];
    session.groups.forEach(g => {
      g.members.forEach(m => {
        rows.push([g.name, m.name, String(session.points[m.key] || 0), m.studentId ? '是' : '否']);
      });
    });
    // 汇总
    rows.push([]);
    rows.push(['— 组别平均分 —', '', '', '']);
    session.groups.forEach(g => {
      rows.push([g.name, `${g.members.length} 人`, String(groupScore(g)), '']);
    });
    const csv = '\uFEFF' + rows
      .map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `临时分组PK_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast.success('已导出本场战绩');
  };

  const totalMembers = session?.groups.reduce((s, g) => s + g.members.length, 0) ?? 0;

  return (
    <div className="space-y-4">
      {/* ═══ 导入与分组 ═══ */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Swords className="w-5 h-5" />
            临时分组 PK
          </CardTitle>
          <CardDescription>
            粘贴姓名快速分成若干小组实时对战加分。匹配到系统学员的会真实加经验值；未匹配的仅计分。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <textarea
            className="w-full h-28 text-base border rounded-lg p-3 resize-y bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium"
            placeholder={'每行一个姓名，也可用逗号 / 空格 / 顿号分隔，例如：\n张三\n李四、王五\n赵六 孙七'}
            value={importText}
            onChange={e => setImportText(e.target.value)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-muted-foreground">分组数：</span>
              {[2, 3, 4].map(n => (
                <button
                  key={n}
                  className={`w-9 h-9 rounded-lg text-sm font-bold border transition-all ${
                    groupCount === n
                      ? 'bg-primary text-primary-foreground border-primary scale-105'
                      : 'border-border hover:bg-muted'
                  }`}
                  onClick={() => setGroupCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
            <Button onClick={handleImport} disabled={!importText.trim()} className="gap-1.5">
              <Shuffle className="w-4 h-4" />
              导入并随机分组
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ═══ 无学生数据提示 ═══ */}
      {students.length === 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="py-3 text-center text-amber-700 text-sm">
            系统中还没有学员，导入的姓名将只能计分、无法加经验值。可先去「训练家」页面导入学生。
          </CardContent>
        </Card>
      )}

      {/* ═══ 空状态 ═══ */}
      {!session && (
        <Card>
          <CardContent className="py-14 text-center text-muted-foreground">
            <div className="text-5xl mb-3">🎯</div>
            <div className="font-medium mb-1">还没有进行中的分组对战</div>
            <div className="text-sm">在上方粘贴姓名，点击「导入并随机分组」开始</div>
          </CardContent>
        </Card>
      )}

      {/* ═══ 对战看板 ═══ */}
      {session && (
        <>
          {/* 控制栏 */}
          <Card>
            <CardContent className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1.5 mr-1">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-bold">{totalMembers}</span>
                  <span className="text-sm text-muted-foreground">人 · {session.groups.length} 组</span>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg border bg-muted/30">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">自定义分值</span>
                  <input
                    type="number"
                    min={1}
                    className="w-14 text-base text-center border rounded px-1 py-0.5 bg-background"
                    value={customValue}
                    onChange={e => setCustomValue(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </div>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={handleReshuffle}>
                  <RefreshCw className="w-3.5 h-3.5" /> 重新分组
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setConfirmReset(true)}>
                  <RotateCcw className="w-3.5 h-3.5" /> 重置比分
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={handleExport}>
                  <Download className="w-3.5 h-3.5" /> 导出战绩
                </Button>
                <Button size="sm" variant="ghost" className="gap-1.5 text-destructive hover:text-destructive" onClick={() => setConfirmClear(true)}>
                  <Trash2 className="w-3.5 h-3.5" /> 解散分组
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 总分对比条 */}
          <Card>
            <CardContent className="py-4">
              <div className="flex rounded-xl overflow-hidden h-12 border" style={{ borderColor: 'var(--color-accent-soft)' }}>
                {ranked.map(({ group, score, isLeader }) => {
                  const max = Math.max(0, ...ranked.map(r => r.score));
                  const widthPct = max > 0 ? (score / max) * 100 : 100 / ranked.length;
                  return (
                    <div
                      key={group.id}
                      className="flex items-center justify-center gap-1.5 text-white font-black text-sm transition-all duration-300 relative overflow-hidden"
                      style={{
                        width: `${Math.max(widthPct, 8)}%`,
                        background: `linear-gradient(135deg, ${group.color}, ${group.color}cc)`,
                        boxShadow: isLeader ? `inset 0 0 0 2px rgba(255,215,0,0.9), 0 0 16px ${group.color}80` : 'none',
                      }}
                    >
                      {isLeader && <Trophy className="w-4 h-4 text-yellow-200" />}
                      <span className="truncate px-1">{group.name}</span>
                      <span className="tabular-nums">{score}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs text-center mt-2 text-muted-foreground">
                领先小组会高亮显示 · 条宽按平均分比例
              </p>
            </CardContent>
          </Card>

          {/* 各组卡片 */}
          <div className={`grid grid-cols-1 gap-4 ${session.groups.length === 2 ? 'md:grid-cols-2' : session.groups.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2 lg:grid-cols-4'}`}>
            {ranked.map(({ group, score, isLeader }) => (
              <Card key={group.id} className="overflow-hidden" style={{ boxShadow: isLeader ? `0 0 0 2px ${group.color}, 0 6px 20px ${group.color}40` : undefined }}>
                {/* 组色条 */}
                <div style={{ height: 5, background: group.color }} />
                <CardContent className="pt-3 pb-3 space-y-3">
                  {/* 头部 */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-black" style={{ color: group.color }}>
                      {isLeader && <Trophy className="w-4 h-4 text-yellow-500" />}
                      {group.name}
                    </div>
                    <span className="text-xs text-muted-foreground">{group.members.length} 人</span>
                  </div>

                  {/* 大比分（小组平均分） */}
                  <div className="text-center py-1">
                    <div className="text-5xl font-black tabular-nums leading-none" style={{ color: group.color }}>
                      {Number.isInteger(score) ? score : score.toFixed(1)}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">小组平均分</div>
                  </div>

                  {/* 整组快捷加分 */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {QUICK_POINTS.map(n => (
                      <button
                        key={n}
                        className="min-h-[44px] rounded-lg font-black text-white text-base transition-all active:scale-95"
                        style={{ background: `linear-gradient(135deg, ${group.color}, ${group.color}cc)` }}
                        onClick={() => addToGroup(group, n)}
                      >
                        +{n}
                      </button>
                    ))}
                    <button
                      className="min-h-[44px] rounded-lg font-black text-sm border-2 transition-all active:scale-95"
                      style={{ borderColor: group.color, color: group.color, background: `${group.color}12` }}
                      onClick={() => addToGroup(group, customValue)}
                      title={`给整组每人 +${customValue}`}
                    >
                      全组+
                    </button>
                  </div>

                  {/* 成员列表 */}
                  <div className="space-y-1 max-h-56 overflow-y-auto pr-0.5">
                    {group.members.length === 0 ? (
                      <div className="text-xs text-muted-foreground text-center py-3">暂无成员</div>
                    ) : (
                      group.members.map(m => {
                        const pt = petOf(m.studentId);
                        return (
                          <div key={m.key} className="flex items-center gap-1.5 px-1.5 py-1 rounded-lg hover:bg-muted/50 group">
                            <span className="text-base w-5 text-center shrink-0">{pt?.emoji || '👤'}</span>
                            <span className="text-sm flex-1 truncate">{m.name}</span>
                            {!m.studentId && <span className="text-[10px] text-amber-500 shrink-0">来宾</span>}
                            <span className="text-xs font-bold tabular-nums w-8 text-right shrink-0" style={{ color: group.color }}>
                              {session.points[m.key] || 0}
                            </span>
                            {/* 移动到其他组 */}
                            <div className="relative shrink-0">
                              <button
                                className="w-6 h-6 rounded text-muted-foreground hover:text-primary hover:bg-muted flex items-center justify-center text-xs"
                                title="移动到其他组"
                                onClick={() => setMoveMenuFor(moveMenuFor === m.key ? null : m.key)}
                              >
                                ⇄
                              </button>
                              {moveMenuFor === m.key && (
                                <>
                                  <div className="fixed inset-0 z-10" onClick={() => setMoveMenuFor(null)} />
                                  <div className="absolute right-0 top-full mt-1 z-20 bg-background border rounded-lg shadow-lg py-1 min-w-[96px]">
                                    {session.groups.filter(g => g.id !== group.id).map(g => (
                                      <button
                                        key={g.id}
                                        className="w-full px-2 py-1.5 text-left text-sm hover:bg-muted flex items-center gap-2"
                                        onClick={() => moveMember(m.key, g.id)}
                                      >
                                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: g.color }} />
                                        {g.name}
                                      </button>
                                    ))}
                                  </div>
                                </>
                              )}
                            </div>
                            {/* 个人加分 */}
                            <button
                              className="min-w-[26px] h-6 rounded bg-muted hover:bg-primary hover:text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0"
                              title={`给 ${m.name} +${customValue}`}
                              onClick={() => addToMember(m, customValue)}
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* 加人 */}
                  <div className="flex items-center gap-1.5 pt-2 mt-1 border-t border-dashed" style={{ borderColor: 'var(--color-accent-soft)' }}>
                    <input
                      type="text"
                      className="flex-1 min-w-0 text-base border rounded-lg px-2 py-1.5 bg-background"
                      placeholder="输入姓名加人"
                      value={addInputs[group.id] || ''}
                      onChange={e => setAddInputs(prev => ({ ...prev, [group.id]: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') addMemberToGroup(group, addInputs[group.id] || ''); }}
                    />
                    <button
                      className="min-h-[40px] px-4 rounded-lg font-bold text-white text-sm shrink-0 transition-all active:scale-95"
                      style={{ background: group.color }}
                      onClick={() => addMemberToGroup(group, addInputs[group.id] || '')}
                    >加人</button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}

      {/* 重置比分确认 */}
      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重置本场比分？</AlertDialogTitle>
            <AlertDialogDescription>
              将清空所有小组的本场得分（分组保留）。已经加给学员的经验值不会撤回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetScores}>确认重置</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 解散分组确认 */}
      <AlertDialog open={confirmClear} onOpenChange={setConfirmClear}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>解散临时分组？</AlertDialogTitle>
            <AlertDialogDescription>
              将清除当前所有小组和本场比分记录。已经加给学员的经验值不会撤回。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleClear}>
              确认解散
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
