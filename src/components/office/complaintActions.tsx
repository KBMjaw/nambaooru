import 'server-only';
import type { ReactNode } from 'react';
import { has, type AuthUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import type { ComplaintDetail } from '@/lib/complaint-detail';
import type { TFn, MessageKey } from '@/i18n';
import { ActionForm, type UserOpt, type ClassifyOpts } from './ActionForm';

const WORK = ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REWORK_REQUIRED'];
const RESOLVABLE = ['AI_CLASSIFIED', 'REOPENED', 'INITIAL_REVIEW', 'SITE_INSPECTION', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REWORK_REQUIRED', 'VERIFICATION_PENDING'];
const FINAL = ['CLOSED', 'REJECTED', 'DUPLICATE'];
const ACTIVE = ['PENDING', 'ACCEPTED', 'IN_PROGRESS'];

interface Work { staff: UserOpt[]; staffWithSelf: UserOpt[]; supervisors: UserOpt[]; departments: { id: number; name_en: string }[] }

/**
 * Every workflow action this user may take on this complaint right now, most relevant first, plus the
 * recommended next step. Built from permissions, assignment and status; the action API re-checks all of it.
 */
export async function complaintActions(u: AuthUser, d: ComplaintDetail, work: Work, t: TFn, lang: 'en' | 'ta', portal: 'OFFICE' | 'ADMIN' = 'OFFICE') {
  const { c } = d;
  const code = c.code as string;
  const status = c.status as string;
  const open = !FINAL.includes(status);
  const nodes: ReactNode[] = [];
  const k = (x: string) => `${code}-${x}`;
  const P = { code, portal, block: true } as const;
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');

  const team = d.assignments.filter((a) => a.purpose === 'WORK' && ACTIVE.includes(a.status as string) && a.assignee_role !== 'SUPERVISOR');
  const supportTeam: UserOpt[] = team.filter((a) => a.assignee_role === 'SUPPORT').map((a) => ({ id: a.assigned_to as string, full_name: a.assignee_name as string, role: a.assignee_role_code as string, role_name: a.assignee_role_en as string }));
  const myWork = d.assignments.find((a) => a.purpose === 'WORK' && a.assigned_to === u.id && a.assignee_role !== 'SUPERVISOR' && ACTIVE.includes(a.status as string));
  const myDone = d.assignments.some((a) => a.purpose === 'WORK' && a.assigned_to === u.id && a.assignee_role !== 'SUPERVISOR' && a.status === 'COMPLETED');
  const pending = d.completions.find((x) => x.verification_status === 'PENDING');
  const noIssue = pending?.proposed_resolution === 'NO_ISSUE_FOUND';
  const inspectors: UserOpt[] = has(u, 'complaint.inspect') ? work.staffWithSelf : work.staff;

  let classify: ClassifyOpts | null = null;
  const canCategory = has(u, 'complaint.review');
  const canDepartment = has(u, 'complaint.assign');
  if (open && (canCategory || canDepartment)) {
    const [cats, its] = await Promise.all([
      sql`SELECT id, name_en, name_ta, icon FROM complaint_categories WHERE status = 'ACTIVE' ORDER BY sort_order`,
      sql`SELECT id, category_id, name_en, name_ta FROM complaint_issue_types WHERE status = 'ACTIVE' ORDER BY sort_order, id`,
    ]);
    classify = {
      categories: cats.map((x) => ({ id: x.id as number, name: `${x.icon} ${L(x.name_en, x.name_ta)}` })),
      issueTypes: its.map((x) => ({ id: x.id as number, category_id: x.category_id as number, name: L(x.name_en, x.name_ta) })),
      departments: work.departments.map((x) => ({ id: x.id, name: x.name_en })),
      canCategory, canDepartment,
    };
  }

  // ---- Field work (the assignee's own actions come first: that is their job) ----
  const fieldActor = !!myWork && has(u, 'complaint.work');
  if (fieldActor) {
    if (['ASSIGNED', 'REWORK_REQUIRED'].includes(status)) {
      nodes.push(<ActionForm key={k('st')} {...P} action="start" label={t(status === 'REWORK_REQUIRED' ? 'wf.startRework' : 'field.start')} icon="▶️" tone="btn-primary" fields={['photo', 'gps', 'note']} hint={t('wf.beforePhotoHint')} />);
      if (myWork!.status === 'PENDING') nodes.push(<ActionForm key={k('acc')} {...P} action="accept" label={t('field.accept')} icon="👍" />);
    }
    if (status === 'IN_PROGRESS') {
      nodes.push(<ActionForm key={k('cp')} {...P} action="complete" label={t('field.complete')} icon="✅" tone="btn-primary" fields={['notes', 'photoRequired', 'gpsRequired', 'submitToggle']} />);
      nodes.push(<ActionForm key={k('pr')} {...P} action="progress" label={t('field.progress')} icon="📤" tone="btn-outline" fields={['progress', 'notes', 'photo', 'gps']} />);
    }
    if (['ASSIGNED', 'IN_PROGRESS'].includes(status))
      nodes.push(<ActionForm key={k('ni')} {...P} action="report_no_issue" label={t('wf.reportNoIssue')} icon="🚫" tone="btn-outline" fields={['notes', 'photoRequired', 'gpsRequired']} hint={t('wf.reportNoIssueHint')} />);
    if (WORK.includes(status)) nodes.push(<ActionForm key={k('fn')} {...P} action="note" label={t('wf.addNote')} icon="📝" tone="btn-ghost" fields={['notes', 'photo']} />);
  }
  const canHold = fieldActor || has(u, 'complaint.reassign');
  if (canHold && ['ASSIGNED', 'IN_PROGRESS', 'REWORK_REQUIRED'].includes(status))
    nodes.push(<ActionForm key={k('hold')} {...P} action="hold" label={t('wf.hold')} icon="⏸️" tone="btn-outline" fields={['holdReason', 'note']} />);
  if (canHold && status === 'ON_HOLD')
    nodes.push(<ActionForm key={k('res')} {...P} action="resume" label={t('wf.resume')} icon="▶️" tone="btn-primary" fields={['note']} />);
  if (status === 'WORK_COMPLETED' && ((myDone && has(u, 'complaint.work')) || has(u, 'complaint.verify')))
    nodes.push(<ActionForm key={k('sv')} {...P} action="submit_verification" label={t('wf.submitForVerification')} icon="📨" tone="btn-primary" fields={['note']} />);

  // ---- Intake, classification, inspection ----
  if (['AI_CLASSIFIED', 'REOPENED', 'SUBMITTED'].includes(status) && has(u, 'complaint.review'))
    nodes.push(<ActionForm key={k('review')} {...P} action="review" label={t('wf.acknowledge')} icon="🧐" tone="btn-primary" fields={['note']} />);
  if (classify)
    nodes.push(<ActionForm key={k('cls')} {...P} action="classify" label={t('wf.classify')} icon="🏷️" tone="btn-outline" fields={['classify', 'note']} classify={classify}
      defaults={{ categoryId: String(c.category_id ?? ''), issueTypeId: String(c.issue_type_id ?? ''), departmentId: String(c.department_id ?? '') }} />);
  if (['INITIAL_REVIEW'].includes(status) && has(u, 'complaint.review') && !c.inspection_required)
    nodes.push(<ActionForm key={k('vd')} {...P} action="verify_direct" label={t('office.verifyWithoutInspection')} icon="✔️" tone="btn-primary" fields={['note']} />);
  if (['AI_CLASSIFIED', 'REOPENED', 'INITIAL_REVIEW', 'SITE_INSPECTION'].includes(status) && has(u, 'complaint.schedule_inspection'))
    nodes.push(<ActionForm key={k('insp')} {...P} action="schedule_inspection" label={status === 'SITE_INSPECTION' ? `${t('office.reassign')} — ${t('office.inspector')}` : t('office.sendInspection')} icon="🔍" tone={status === 'INITIAL_REVIEW' && c.inspection_required ? 'btn-primary' : 'btn-outline'} fields={['inspector', 'dueAt', 'note']} users={inspectors} />);
  if (status === 'SITE_INSPECTION' && has(u, 'complaint.inspect') && (u.scope !== 'ASSIGNED' || c.inspector_id === u.id))
    nodes.push(<ActionForm key={k('rec')} {...P} action="inspect" label={t('office.recordInspection')} icon="📝" tone="btn-primary" fields={['outcome', 'notes', 'photoRequired', 'gpsRequired']} />);

  // ---- Assignment ----
  if (status === 'VERIFIED' && has(u, 'complaint.assign'))
    nodes.push(<ActionForm key={k('as')} {...P} action="assign" label={t('office.assign')} icon="👷" tone="btn-primary" fields={['assignee', 'supporters', 'supervisor', 'priority', 'dueAt', 'note']} users={work.staff} supervisors={work.supervisors} defaults={{ priority: c.priority as string }} />);
  if (WORK.includes(status) && has(u, 'complaint.reassign')) {
    nodes.push(<ActionForm key={k('ras')} {...P} action="reassign" label={t('office.reassign')} icon="🔄" tone="btn-outline" fields={['assignee', 'supporters', 'supervisor', 'priority', 'dueAt', 'noteRequired']} users={work.staff} supervisors={work.supervisors} defaults={{ priority: c.priority as string }} />);
    nodes.push(<ActionForm key={k('asp')} {...P} action="add_support" label={t('office.addSupport')} icon="➕" tone="btn-outline" fields={['user', 'note']} users={work.staff.filter((s) => !team.some((x) => x.assigned_to === s.id))} />);
    if (supportTeam.length) nodes.push(<ActionForm key={k('rsp')} {...P} action="remove_support" label={t('office.removeSupport')} icon="➖" tone="btn-ghost" fields={['user', 'noteRequired']} users={supportTeam} />);
  }
  if (open && has(u, 'complaint.assign') && work.supervisors.length)
    nodes.push(<ActionForm key={k('sup')} {...P} action="assign_supervisor" label={t('wf.assignSupervisor')} icon="🧑‍💼" tone="btn-outline" fields={['user', 'note']} users={work.supervisors} />);

  // ---- Verification & closure ----
  if (['VERIFICATION_PENDING', 'WORK_COMPLETED'].includes(status) && has(u, 'complaint.verify') && pending && pending.completed_by !== u.id) {
    const approveFields = noIssue || !has(u, 'complaint.close') ? ['method', 'notes'] as const : ['method', 'notes', 'closeToggle'] as const;
    if (!noIssue || has(u, 'complaint.reject'))
      nodes.push(<ActionForm key={k('vc')} {...P} action="verify_completion" label={t(noIssue ? 'wf.confirmNoIssue' : 'office.approveClose')} icon="🏁" tone="btn-primary" fields={[...approveFields]} extra={{ decision: 'approve' }} defaults={{ method: 'EVIDENCE' }} />);
    nodes.push(<ActionForm key={k('sb')} {...P} action="verify_completion" label={t('wf.sendRework')} icon="↩️" tone="btn-outline" fields={['method', 'notes']} extra={{ decision: 'send_back' }} defaults={{ method: 'EVIDENCE' }} />);
  }
  if (status === 'COMPLETION_VERIFIED' && has(u, 'complaint.close'))
    nodes.push(<ActionForm key={k('cl')} {...P} action="close" label={t('office.close')} icon="🔒" tone="btn-primary" fields={['note']} />);
  if (RESOLVABLE.includes(status) && has(u, 'complaint.reject'))
    nodes.push(<ActionForm key={k('rj')} {...P} action="reject" label={t('wf.resolveAs')} icon="⛔" tone="btn-danger" fields={['reason', 'notes']}
      defaults={c.inspection_outcome && !['VERIFIED', 'REQUIRES_HIGHER_AUTHORITY'].includes(c.inspection_outcome as string) ? { reason: c.inspection_outcome as string } : {}} />);
  if (!open && has(u, 'complaint.reopen'))
    nodes.push(<ActionForm key={k('ro')} {...P} action="reopen" label={t('office.reopen')} icon="🔓" tone="btn-outline" fields={['noteRequired']} />);
  if (open && has(u, 'complaint.escalate') && (c.escalation_level as number) < 4)
    nodes.push(<ActionForm key={k('esc')} {...P} action="escalate" label={t('office.escalate')} icon="⬆️" tone="btn-outline" fields={['level', 'note']} />);
  if (has(u, 'complaint.remark'))
    nodes.push(<ActionForm key={k('rm')} {...P} action="remark" label={t('office.remark')} icon="💬" tone="btn-ghost" fields={['note']} />);

  const nextKey = (status === 'VERIFICATION_PENDING' && noIssue ? 'next.NO_ISSUE' : `next.${status}`) as MessageKey;
  const holdText = status === 'ON_HOLD' && c.on_hold_reason ? ` — ${t(`hold.${c.on_hold_reason}` as MessageKey)}${c.on_hold_note ? `: ${c.on_hold_note}` : ''}` : '';
  return { nodes, nextStep: `${t(nextKey)}${holdText}` };
}
