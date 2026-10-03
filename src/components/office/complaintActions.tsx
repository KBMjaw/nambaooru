import 'server-only';
import type { ReactNode } from 'react';
import { has, type AuthUser } from '@/lib/auth';
import { sql } from '@/lib/db';
import type { ComplaintDetail } from '@/lib/complaint-detail';
import type { TFn, MessageKey } from '@/i18n';
import { ActionForm, type UserOpt, type ClassifyOpts } from './ActionForm';
import type { RecordType } from './RecordAction';
import { completionPolicy } from '@/lib/completion-policy';
import { requestIsMobile } from '@/lib/request-device';

const WORK = ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REWORK_REQUIRED'];
const RESOLVABLE = ['SUBMITTED', 'AI_CLASSIFIED', 'REOPENED', 'INITIAL_REVIEW', 'SITE_INSPECTION', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REWORK_REQUIRED', 'VERIFICATION_PENDING'];
const FINAL = ['CLOSED', 'REJECTED', 'DUPLICATE'];
const ACTIVE = ['PENDING', 'ACCEPTED', 'IN_PROGRESS'];
/** Open stages from which an officer handling the complaint may mark it completed (the action API re-checks). */
const OFFICER_COMPLETABLE = ['SUBMITTED', 'AI_CLASSIFIED', 'REOPENED', 'INITIAL_REVIEW', 'SITE_INSPECTION', 'VERIFIED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REWORK_REQUIRED'];

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
  const review: ReactNode[] = [];
  const k = (x: string) => `${code}-${x}`;
  const P = { code, portal, block: true } as const;
  const L = (en: unknown, ta: unknown) => String((lang === 'ta' ? ta || en : en || ta) ?? '');

  const FIELD_ROLES = ['PRIMARY', 'SUPPORT'];
  const team = d.assignments.filter((a) => a.purpose === 'WORK' && ACTIVE.includes(a.status as string) && FIELD_ROLES.includes(a.assignee_role as string));
  const supportTeam: UserOpt[] = team.filter((a) => a.assignee_role === 'SUPPORT').map((a) => ({ id: a.assigned_to as string, full_name: a.assignee_name as string, role: a.assignee_role_code as string, role_name: a.assignee_role_en as string }));
  const myWork = d.assignments.find((a) => a.purpose === 'WORK' && a.assigned_to === u.id && FIELD_ROLES.includes(a.assignee_role as string) && ACTIVE.includes(a.status as string));
  const myDone = d.assignments.some((a) => a.purpose === 'WORK' && a.assigned_to === u.id && FIELD_ROLES.includes(a.assignee_role as string) && a.status === 'COMPLETED');
  const pending = d.completions.find((x) => x.verification_status === 'PENDING');
  const noIssue = pending?.proposed_resolution === 'NO_ISSUE_FOUND';
  const inspectors: UserOpt[] = has(u, 'complaint.inspect') ? work.staffWithSelf : work.staff;

  let classify: ClassifyOpts | null = null;
  const canCategory = has(u, 'complaint.review');
  const canDepartment = has(u, 'complaint.assign');
  if (open && (canCategory || canDepartment)) {
    const [cats, subs, its] = await Promise.all([
      sql`SELECT id, name_en, name_ta, icon FROM complaint_categories WHERE status = 'ACTIVE' ORDER BY sort_order`,
      sql`SELECT id, category_id, name_en, name_ta FROM complaint_subcategories WHERE status = 'ACTIVE' ORDER BY sort_order, id`,
      sql`SELECT id, category_id, subcategory_id, name_en, name_ta FROM complaint_issue_types WHERE status = 'ACTIVE' ORDER BY sort_order, id`,
    ]);
    classify = {
      categories: cats.map((x) => ({ id: x.id as number, name: `${x.icon} ${L(x.name_en, x.name_ta)}` })),
      subcategories: subs.map((x) => ({ id: x.id as number, category_id: x.category_id as number, name: L(x.name_en, x.name_ta) })),
      issueTypes: its.map((x) => ({ id: x.id as number, category_id: x.category_id as number, subcategory_id: (x.subcategory_id as number | null) ?? null, name: L(x.name_en, x.name_ta) })),
      departments: work.departments.map((x) => ({ id: x.id, name: x.name_en })),
      canCategory, canDepartment,
    };
  }

  // ---- Field work (the assignee's own actions come first: that is their job) ----
  const fieldActor = !!myWork && has(u, 'complaint.work');
  // Start / accept / action taken / completion / notes / hold are recorded through "Record an action" (RecordAction)
  // Photo + GPS rules for "Mark as completed" (distance and live photo for lower grade; GPS only for higher grade)
  const completion = completionPolicy(u.roleRank, await requestIsMobile(), c.latitude, c.longitude);
  if (fieldActor && ['ASSIGNED', 'IN_PROGRESS'].includes(status))
    nodes.push(<ActionForm key={k('ni')} {...P} action="report_no_issue" label={t('wf.reportNoIssue')} icon="🚫" tone="btn-outline" fields={['notes', 'photoRequired', 'gpsRequired']} hint={t('wf.reportNoIssueHint')} completion={completion} />);
  const onTeam = d.assignments.some((a) => a.assigned_to === u.id && ACTIVE.includes(a.status as string));
  if ((fieldActor || (has(u, 'evidence.upload') && u.scope !== 'ASSIGNED')) && ['ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'REWORK_REQUIRED', 'SITE_INSPECTION', 'VERIFIED'].includes(status))
    nodes.push(<ActionForm key={k('ue')} {...P} action="upload_evidence" label={t('wf.uploadEvidence')} icon="📷" tone="btn-outline" fields={['evidenceKind', 'photoRequired', 'gps', 'note']} defaults={{ evidenceKind: status === 'ASSIGNED' ? 'BEFORE_WORK' : 'PROGRESS' }} />);
  const canHold = fieldActor || has(u, 'complaint.reassign');
  if (canHold && status === 'ON_HOLD')
    nodes.push(<ActionForm key={k('res')} {...P} action="resume" label={t('wf.resume')} icon="▶️" tone="btn-primary" fields={['note']} />);
  if (status === 'WORK_COMPLETED' && ((myDone && has(u, 'complaint.work')) || has(u, 'complaint.verify')))
    nodes.push(<ActionForm key={k('sv')} {...P} action="submit_verification" label={t('wf.submitForVerification')} icon="📨" tone="btn-primary" fields={['note']} />);

  // ---- Intake, classification, inspection ----
  if (classify)
    nodes.push(<ActionForm key={k('cls')} {...P} action="classify" label={t('wf.classify')} icon="🏷️" tone="btn-outline" fields={['classify', 'note']} classify={classify}
      defaults={{ categoryId: String(c.category_id ?? ''), subcategoryId: String(c.subcategory_id ?? ''), issueTypeId: String(c.issue_type_id ?? ''), departmentId: String(c.department_id ?? '') }} />);
  if (open && has(u, 'complaint.review'))
    nodes.push(<ActionForm key={k('ri')} {...P} action="request_info" label={t('wf.requestInfo')} icon="❓" tone="btn-outline" fields={['noteRequired']} hint={t('wf.requestInfoHint')} />);
  if (['SUBMITTED', 'AI_CLASSIFIED', 'REOPENED', 'INITIAL_REVIEW', 'SITE_INSPECTION'].includes(status) && has(u, 'complaint.schedule_inspection'))
    nodes.push(<ActionForm key={k('insp')} {...P} action="schedule_inspection" label={status === 'SITE_INSPECTION' ? `${t('office.reassign')} — ${t('office.inspector')}` : t('office.sendInspection')} icon="🔍" tone={status === 'INITIAL_REVIEW' && c.inspection_required ? 'btn-primary' : 'btn-outline'} fields={['inspector', 'dueAt', 'note']} users={inspectors} />);

  // ---- Assignment ----
  if (['VERIFIED', 'REOPENED'].includes(status) && has(u, 'complaint.assign'))
    nodes.push(<ActionForm key={k('as')} {...P} action="assign" label={t('office.assign')} icon="👷" tone="btn-primary" fields={['assignee', 'supporters', 'supervisor', 'priority', 'dueAt', 'note']} users={work.staff} supervisors={work.supervisors} defaults={{ priority: c.priority as string }} />);
  if (WORK.includes(status) && has(u, 'complaint.reassign')) {
    nodes.push(<ActionForm key={k('ras')} {...P} action="reassign" label={t('office.reassign')} icon="🔄" tone="btn-outline" fields={['assignee', 'supporters', 'supervisor', 'priority', 'dueAt', 'noteRequired']} users={work.staff} supervisors={work.supervisors} defaults={{ priority: c.priority as string }} />);
    nodes.push(<ActionForm key={k('asp')} {...P} action="add_support" label={t('office.addSupport')} icon="➕" tone="btn-outline" fields={['user', 'note']} users={work.staff.filter((s) => !team.some((x) => x.assigned_to === s.id))} />);
    if (supportTeam.length) nodes.push(<ActionForm key={k('rsp')} {...P} action="remove_support" label={t('office.removeSupport')} icon="➖" tone="btn-ghost" fields={['user', 'noteRequired']} users={supportTeam} />);
  }
  if (open && has(u, 'complaint.assign') && work.supervisors.length) {
    nodes.push(<ActionForm key={k('sup')} {...P} action="assign_supervisor" label={t('wf.assignSupervisor')} icon="🧑‍💼" tone="btn-outline" fields={['user', 'note']} users={work.supervisors} />);
    nodes.push(<ActionForm key={k('ver')} {...P} action="assign_verifier" label={t('wf.assignVerifier')} icon="🔎" tone="btn-outline" fields={['user', 'note']} users={work.supervisors} />);
  }
  if (open && has(u, 'complaint.assign'))
    nodes.push(<ActionForm key={k('due')} {...P} action="set_due" label={t('wf.setDue')} icon="📅" tone="btn-ghost" fields={['dueRequired', 'noteRequired']} />);

  // ---- Final approval (EO / Admin above the EO) & send back for rework (also Supervisor / Dept officer) ----
  const canFinal = has(u, 'complaint.final_approve');
  const canReview = canFinal || has(u, 'complaint.verify');
  if (['VERIFICATION_PENDING', 'WORK_COMPLETED'].includes(status) && canReview && pending && pending.completed_by !== u.id) {
    review.push(...reviewButtons(u, code, portal, noIssue, t));
    if (canFinal && has(u, 'complaint.reject') && !noIssue) {
      nodes.push(<ActionForm key={k('vni')} {...P} action="verify_completion" label={t('wf.verifyNoIssue')} icon="🚫" tone="btn-ghost" fields={['method', 'notes']} extra={{ decision: 'no_issue' }} defaults={{ method: 'FIELD' }} />);
      nodes.push(<ActionForm key={k('vcv')} {...P} action="verify_completion" label={t('wf.verifyCannot')} icon="❔" tone="btn-ghost" fields={['method', 'notes']} extra={{ decision: 'cannot_verify' }} defaults={{ method: 'FIELD' }} />);
    }
  }
  if (status === 'COMPLETION_VERIFIED' && canFinal)
    nodes.push(<ActionForm key={k('cl')} {...P} action="close" label={t('office.close')} icon="🔒" tone="btn-primary" fields={['noteRequired']} hint={t('wf.closeHint')} />);
  if (RESOLVABLE.includes(status) && has(u, 'complaint.reject'))
    nodes.push(<ActionForm key={k('rj')} {...P} action="reject" label={t('wf.resolveAs')} icon="⛔" tone="btn-danger" fields={['reason', 'notes']}
      defaults={c.inspection_outcome && !['VERIFIED', 'REQUIRES_HIGHER_AUTHORITY'].includes(c.inspection_outcome as string) ? { reason: c.inspection_outcome as string } : {}} />);
  if (!open && has(u, 'complaint.reopen'))
    nodes.push(<ActionForm key={k('ro')} {...P} action="reopen" label={t(status === 'CLOSED' ? 'office.reopen' : 'wf.acceptComplaint')} icon="🔓" tone={status === 'CLOSED' ? 'btn-outline' : 'btn-primary'} fields={['noteRequired']} hint={status === 'CLOSED' ? undefined : t('wf.acceptHint')} />);
  if (open && has(u, 'complaint.escalate') && (c.escalation_level as number) < 4)
    nodes.push(<ActionForm key={k('esc')} {...P} action="escalate" label={t('office.escalate')} icon="⬆️" tone="btn-outline" fields={['level', 'note']} />);
  // Field staff write notes through their own "Add note" (above); others use the action note

  // ---- Action types offered in "Record an action" (planRecord in the action API maps and re-checks them) ----
  const types: RecordType[] = [];
  const pendingMine = fieldActor && myWork!.status === 'PENDING' && ['ASSIGNED', 'REWORK_REQUIRED'].includes(status);
  const intake = ['SUBMITTED', 'AI_CLASSIFIED', 'REOPENED'].includes(status);
  if (pendingMine || (intake && has(u, 'complaint.review'))) types.push('ACKNOWLEDGE');
  if (pendingMine || ((intake || status === 'INITIAL_REVIEW') && has(u, 'complaint.review') && !c.inspection_required) || (!open && has(u, 'complaint.reopen'))) types.push('ACCEPT');
  if ((status === 'SITE_INSPECTION' && has(u, 'complaint.inspect') && (u.scope !== 'ASSIGNED' || c.inspector_id === u.id))
    || ((intake || status === 'INITIAL_REVIEW') && has(u, 'complaint.inspect') && has(u, 'complaint.schedule_inspection'))) types.push('INSPECT');
  if (fieldActor && ['ASSIGNED', 'REWORK_REQUIRED', 'IN_PROGRESS'].includes(status)) {
    types.push('ACTION_TAKEN');
    if (status !== 'IN_PROGRESS') types.push('WORK_STARTED');
    types.push('WORK_COMPLETED');
  } else if (!fieldActor && has(u, 'complaint.complete') && OFFICER_COMPLETABLE.includes(status)) {
    // "Mark as completed" for every category by the officer handling the complaint (incl. the EO)
    types.push('WORK_COMPLETED');
  }
  if (canHold && ['ASSIGNED', 'IN_PROGRESS', 'REWORK_REQUIRED'].includes(status)) types.push('ON_HOLD');
  if (['VERIFICATION_PENDING', 'WORK_COMPLETED'].includes(status) && canReview && pending && pending.completed_by !== u.id) types.push('REWORK_REQUIRED');
  if (open && (has(u, 'complaint.remark') || onTeam)) types.push('OTHER');
  const photoTypes: RecordType[] = fieldActor ? ['WORK_STARTED', 'OTHER', 'REWORK_REQUIRED'] : ['REWORK_REQUIRED'];

  const nextKey = (status === 'VERIFICATION_PENDING' && noIssue ? 'next.NO_ISSUE' : `next.${status}`) as MessageKey;
  const holdText = status === 'ON_HOLD' && c.on_hold_reason ? ` — ${t(`hold.${c.on_hold_reason}` as MessageKey)}${c.on_hold_note ? `: ${c.on_hold_note}` : ''}` : '';
  return { nodes, review, record: { types, photoTypes, completion }, nextStep: `${t(nextKey)}${holdText}` };
}

/**
 * Final approval — APPROVE & CLOSE (EO / Admin above the EO) — and REJECT / REWORK for completed work.
 * A Supervisor / Dept officer who verifies work sees only REWORK.
 */
export function reviewButtons(u: AuthUser, code: string, portal: 'OFFICE' | 'ADMIN', noIssue: boolean, t: TFn): ReactNode[] {
  const P = { code, portal, block: true } as const;
  const out: ReactNode[] = [];
  if (has(u, 'complaint.final_approve') && (!noIssue || has(u, 'complaint.reject')))
    out.push(<ActionForm key="rv-approve" {...P} action="verify_completion" label={noIssue ? t('wf.confirmNoIssue') : t('rv.approveClose')} icon="✅" tone="btn-primary"
      fields={noIssue ? ['method', 'notes'] : ['notesRequired']} notesLabel={t(noIssue ? 'rv.approveNote' : 'rv.closeNote')} extra={noIssue ? { decision: 'approve' } : { decision: 'approve', method: 'EVIDENCE' }} defaults={{ method: 'EVIDENCE' }} />);
  out.push(<ActionForm key="rv-rework" {...P} action="verify_completion" label={t('rv.rework')} icon="↩️" tone="btn-danger" fields={['notesRequired', 'publicReason']} notesLabel={t('rv.reworkReason')}
    extra={{ decision: 'send_back', method: 'EVIDENCE' }} hint={t('ra.hint.REWORK_REQUIRED')} />);
  return out;
}
