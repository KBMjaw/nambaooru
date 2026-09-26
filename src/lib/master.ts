/**
 * Master-data entity registry for the admin portal. Only the tables and columns declared
 * here can be read or written through the generic admin API (strict whitelist). Records
 * are never hard-deleted: they are deactivated so historical complaints keep their references.
 */
export type ColType = 'text' | 'textarea' | 'number' | 'float' | 'bool' | 'select' | 'ref' | 'array' | 'status';

export interface Col {
  key: string;
  label: string;
  type: ColType;
  required?: boolean;
  options?: string[];
  ref?: string; // entity name for ref lookups
  nullable?: boolean;
  list?: boolean; // show in table (default true)
  readOnlyOnEdit?: boolean;
}

export interface Entity {
  table: string;
  title: string;
  perm: string;
  pk: string;
  pkType: 'int' | 'text';
  cols: Col[];
  search: string[];
  order: string;
  statusCol?: { key: string; active: unknown; inactive: unknown };
  refLabel?: string; // SQL expression (alias t) used when this entity is a ref target
  refJoin?: string;
  filterBy?: string; // column that can be filtered via ?parent=
}

const STATUS: Col = { key: 'status', label: 'Status', type: 'status' };
const ACTIVE = { key: 'status', active: 'ACTIVE', inactive: 'INACTIVE' };
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

export const ENTITIES: Record<string, Entity> = {
  states: {
    table: 'states', title: 'States', perm: 'location.manage', pk: 'id', pkType: 'int', order: 'name_en', search: ['name_en', 'code'], statusCol: ACTIVE,
    refLabel: 't.name_en',
    cols: [{ key: 'code', label: 'Code', type: 'text', required: true }, { key: 'name_en', label: 'Name (EN)', type: 'text', required: true }, { key: 'name_ta', label: 'Name (TA)', type: 'text' }, STATUS],
  },
  districts: {
    table: 'districts', title: 'Districts', perm: 'location.manage', pk: 'id', pkType: 'int', order: 'name_en', search: ['name_en', 'name_ta', 'code'], statusCol: ACTIVE,
    refLabel: 't.name_en',
    cols: [
      { key: 'state_id', label: 'State', type: 'ref', ref: 'states', required: true },
      { key: 'code', label: 'Code', type: 'text', required: true }, { key: 'name_en', label: 'Name (EN)', type: 'text', required: true },
      { key: 'name_ta', label: 'Name (TA)', type: 'text' }, { key: 'aliases', label: 'Aliases', type: 'array' }, STATUS,
    ],
  },
  taluks: {
    table: 'taluks', title: 'Taluks', perm: 'location.manage', pk: 'id', pkType: 'int', order: 'name_en', search: ['name_en', 'name_ta'], statusCol: ACTIVE, filterBy: 'district_id',
    refLabel: "t.name_en || ' (' || (SELECT name_en FROM districts d WHERE d.id = t.district_id) || ')'",
    cols: [{ key: 'district_id', label: 'District', type: 'ref', ref: 'districts', required: true }, { key: 'name_en', label: 'Name (EN)', type: 'text', required: true }, { key: 'name_ta', label: 'Name (TA)', type: 'text' }, STATUS],
  },
  blocks: {
    table: 'blocks', title: 'Blocks', perm: 'location.manage', pk: 'id', pkType: 'int', order: 'name_en', search: ['name_en', 'name_ta'], statusCol: ACTIVE, filterBy: 'district_id',
    refLabel: "t.name_en || ' (' || (SELECT name_en FROM districts d WHERE d.id = t.district_id) || ')'",
    cols: [{ key: 'district_id', label: 'District', type: 'ref', ref: 'districts', required: true }, { key: 'name_en', label: 'Name (EN)', type: 'text', required: true }, { key: 'name_ta', label: 'Name (TA)', type: 'text' }, STATUS],
  },
  local_body_types: {
    table: 'local_body_types', title: 'Local Body Types', perm: 'location.manage', pk: 'id', pkType: 'int', order: 'id', search: ['name_en', 'code'],
    refLabel: "t.name_en || ' / ' || t.name_ta",
    cols: [{ key: 'code', label: 'Code', type: 'text', required: true, readOnlyOnEdit: true }, { key: 'category', label: 'Category', type: 'select', options: ['URBAN', 'RURAL'], required: true }, { key: 'name_en', label: 'Name (EN)', type: 'text', required: true }, { key: 'name_ta', label: 'Name (TA)', type: 'text', required: true }],
  },
  local_bodies: {
    table: 'local_bodies', title: 'Local Bodies', perm: 'location.manage', pk: 'id', pkType: 'int', order: 'name_en', search: ['name_en', 'name_ta', 'code'], statusCol: ACTIVE, filterBy: 'district_id',
    refLabel: "t.name_en || ' (' || (SELECT name_en FROM districts d WHERE d.id = t.district_id) || ')'",
    cols: [
      { key: 'code', label: 'Code', type: 'text', required: true }, { key: 'type_id', label: 'Type', type: 'ref', ref: 'local_body_types', required: true },
      { key: 'district_id', label: 'District', type: 'ref', ref: 'districts', required: true }, { key: 'taluk_id', label: 'Taluk', type: 'ref', ref: 'taluks', nullable: true },
      { key: 'block_id', label: 'Block', type: 'ref', ref: 'blocks', nullable: true, list: false },
      { key: 'name_en', label: 'Name (EN)', type: 'text', required: true }, { key: 'name_ta', label: 'Name (TA)', type: 'text' },
      { key: 'controlling_authority', label: 'Controlling authority', type: 'text', nullable: true }, { key: 'pincode', label: 'Pincode', type: 'text', nullable: true, list: false },
      { key: 'center_lat', label: 'Centre lat', type: 'float', nullable: true, list: false }, { key: 'center_lng', label: 'Centre lng', type: 'float', nullable: true, list: false }, STATUS,
    ],
  },
  wards: {
    table: 'wards', title: 'Wards', perm: 'location.manage', pk: 'id', pkType: 'int', order: 'local_body_id, ward_number', search: ['name_en', 'name_ta'], statusCol: ACTIVE, filterBy: 'local_body_id',
    refLabel: "(SELECT name_en FROM local_bodies l WHERE l.id = t.local_body_id) || ' – Ward ' || t.ward_number",
    cols: [
      { key: 'local_body_id', label: 'Local body', type: 'ref', ref: 'local_bodies', required: true }, { key: 'ward_number', label: 'Ward No.', type: 'number', required: true },
      { key: 'name_en', label: 'Ward name (EN)', type: 'text' }, { key: 'name_ta', label: 'Ward name (TA)', type: 'text' },
      { key: 'population', label: 'Population', type: 'number', nullable: true }, { key: 'street_count', label: 'No. of streets', type: 'number', nullable: true },
      { key: 'description', label: 'Description', type: 'textarea', nullable: true, list: false },
      { key: 'center_lat', label: 'Centre lat', type: 'float', nullable: true, list: false }, { key: 'center_lng', label: 'Centre lng', type: 'float', nullable: true, list: false }, STATUS,
    ],
  },
  streets: {
    table: 'streets', title: 'Streets / Areas', perm: 'location.manage', pk: 'id', pkType: 'int', order: 'ward_id, name_en', search: ['name_en', 'name_ta'], statusCol: ACTIVE, filterBy: 'ward_id',
    cols: [{ key: 'ward_id', label: 'Ward', type: 'ref', ref: 'wards', required: true }, { key: 'name_en', label: 'Name (EN)', type: 'text', required: true }, { key: 'name_ta', label: 'Name (TA)', type: 'text' }, STATUS],
  },
  pincodes: {
    table: 'pincodes', title: 'Pincodes', perm: 'location.manage', pk: 'pincode', pkType: 'text', order: 'pincode', search: ['pincode'], statusCol: ACTIVE,
    cols: [{ key: 'pincode', label: 'Pincode', type: 'text', required: true, readOnlyOnEdit: true }, { key: 'state_id', label: 'State', type: 'ref', ref: 'states', nullable: true }, STATUS],
  },
  post_offices: {
    table: 'post_offices', title: 'Post Offices', perm: 'location.manage', pk: 'id', pkType: 'int', order: 'pincode, name', search: ['name', 'pincode'], statusCol: ACTIVE,
    cols: [{ key: 'name', label: 'Name', type: 'text', required: true }, { key: 'pincode', label: 'Pincode', type: 'text', required: true }, { key: 'district_id', label: 'District', type: 'ref', ref: 'districts', nullable: true }, { key: 'taluk_id', label: 'Taluk', type: 'ref', ref: 'taluks', nullable: true }, { key: 'office_type', label: 'Type', type: 'text' }, STATUS],
  },
  postal_locations: {
    table: 'postal_locations', title: 'Postal Locations', perm: 'location.manage', pk: 'id', pkType: 'int', order: 'district_name, place_name', search: ['place_name', 'pincode', 'district_name'], statusCol: ACTIVE,
    refLabel: "t.place_name || ' – ' || t.pincode || ' (' || t.district_name || ')'",
    cols: [
      { key: 'place_name', label: 'Place', type: 'text', required: true }, { key: 'pincode', label: 'Pincode', type: 'text', required: true },
      { key: 'district_name', label: 'District (source)', type: 'text', required: true }, { key: 'district_id', label: 'District (normalised)', type: 'ref', ref: 'districts', nullable: true },
      { key: 'taluk_id', label: 'Taluk', type: 'ref', ref: 'taluks', nullable: true }, { key: 'source_id', label: 'Source #', type: 'number', nullable: true, readOnlyOnEdit: true }, STATUS,
    ],
  },
  postal_location_jurisdictions: {
    table: 'postal_location_jurisdictions', title: 'Postal → Local body mappings', perm: 'location.manage', pk: 'id', pkType: 'int', order: 'id DESC', search: [], statusCol: ACTIVE,
    cols: [
      { key: 'postal_location_id', label: 'Postal location', type: 'ref', ref: 'postal_locations', required: true },
      { key: 'local_body_id', label: 'Local body', type: 'ref', ref: 'local_bodies', required: true },
      { key: 'ward_id', label: 'Ward (optional)', type: 'ref', ref: 'wards', nullable: true },
      { key: 'confidence', label: 'Confidence', type: 'select', options: ['VERIFIED', 'PROBABLE', 'UNVERIFIED'], required: true }, STATUS,
    ],
  },
  departments: {
    table: 'departments', title: 'Departments', perm: 'department.manage', pk: 'id', pkType: 'int', order: 'local_body_id, name_en', search: ['name_en', 'name_ta', 'code'], statusCol: ACTIVE, filterBy: 'local_body_id',
    refLabel: "t.name_en || ' – ' || COALESCE((SELECT name_en FROM local_bodies l WHERE l.id = t.local_body_id), 'template')",
    cols: [{ key: 'code', label: 'Code', type: 'text', required: true }, { key: 'local_body_id', label: 'Local body', type: 'ref', ref: 'local_bodies', nullable: true }, { key: 'name_en', label: 'Name (EN)', type: 'text', required: true }, { key: 'name_ta', label: 'Name (TA)', type: 'text', required: true }, STATUS],
  },
  complaint_categories: {
    table: 'complaint_categories', title: 'Complaint Categories', perm: 'masterdata.manage', pk: 'id', pkType: 'int', order: 'sort_order', search: ['name_en', 'name_ta', 'code'], statusCol: ACTIVE,
    refLabel: "t.icon || ' ' || t.name_en",
    cols: [
      { key: 'code', label: 'Code', type: 'text', required: true, readOnlyOnEdit: true }, { key: 'icon', label: 'Icon', type: 'text' },
      { key: 'name_en', label: 'Name (EN)', type: 'text', required: true }, { key: 'name_ta', label: 'Name (TA)', type: 'text', required: true },
      { key: 'default_department', label: 'Default dept code', type: 'select', options: ['ELECTRICAL', 'WATER', 'ENGINEERING', 'SANITATION', 'HEALTH', 'TOWN_PLANNING', 'GENERAL_ADMIN'], required: true },
      { key: 'evidence_required', label: 'Evidence required', type: 'bool' }, { key: 'evidence_types', label: 'Evidence types', type: 'array' },
      { key: 'inspection_required', label: 'Inspection required', type: 'bool' }, { key: 'default_priority', label: 'Default priority', type: 'select', options: PRIORITIES },
      { key: 'keywords', label: 'Extra NLP keywords (Tamil/Tanglish/English)', type: 'array', list: false }, { key: 'sort_order', label: 'Order', type: 'number' }, STATUS,
    ],
  },
  complaint_issue_types: {
    table: 'complaint_issue_types', title: 'Issue Types (sub-categories)', perm: 'masterdata.manage', pk: 'id', pkType: 'int', order: 'category_id, sort_order', search: ['name_en', 'name_ta', 'code'], statusCol: ACTIVE, filterBy: 'category_id',
    refLabel: 't.name_en',
    cols: [
      { key: 'category_id', label: 'Category', type: 'ref', ref: 'complaint_categories', required: true },
      { key: 'code', label: 'Code', type: 'text', required: true, readOnlyOnEdit: true },
      { key: 'name_en', label: 'Name (EN)', type: 'text', required: true }, { key: 'name_ta', label: 'Name (TA)', type: 'text', required: true },
      { key: 'default_priority', label: 'Default priority', type: 'select', options: PRIORITIES, nullable: true },
      { key: 'keywords', label: 'Keywords for auto-detection', type: 'array', list: false }, { key: 'sort_order', label: 'Order', type: 'number' }, STATUS,
    ],
  },
  sla_rules: {
    table: 'sla_rules', title: 'SLA Rules', perm: 'masterdata.manage', pk: 'id', pkType: 'int', order: 'category_id NULLS FIRST, priority', search: [], statusCol: ACTIVE,
    cols: [
      { key: 'category_id', label: 'Category (blank = default)', type: 'ref', ref: 'complaint_categories', nullable: true }, { key: 'priority', label: 'Priority', type: 'select', options: PRIORITIES, required: true },
      { key: 'local_body_id', label: 'Local body (blank = all)', type: 'ref', ref: 'local_bodies', nullable: true },
      { key: 'inspection_hours', label: 'Inspection (h)', type: 'number', required: true }, { key: 'resolution_hours', label: 'Resolution (h)', type: 'number', required: true },
      { key: 'warn_before_hours', label: 'Warn before (h)', type: 'number', required: true }, STATUS,
    ],
  },
  routing_rules: {
    table: 'routing_rules', title: 'Routing Rules', perm: 'masterdata.manage', pk: 'id', pkType: 'int', order: 'local_body_id, category_id', search: [], statusCol: ACTIVE, filterBy: 'local_body_id',
    cols: [
      { key: 'local_body_id', label: 'Local body', type: 'ref', ref: 'local_bodies', required: true }, { key: 'category_id', label: 'Category', type: 'ref', ref: 'complaint_categories', required: true },
      { key: 'ward_id', label: 'Ward (optional)', type: 'ref', ref: 'wards', nullable: true }, { key: 'department_id', label: 'Department', type: 'ref', ref: 'departments', required: true }, STATUS,
    ],
  },
  notification_templates: {
    table: 'notification_templates', title: 'Notification Templates', perm: 'masterdata.manage', pk: 'id', pkType: 'int', order: 'code', search: ['code', 'title_en'],
    statusCol: { key: 'active', active: true, inactive: false },
    cols: [
      { key: 'code', label: 'Code', type: 'text', required: true, readOnlyOnEdit: true }, { key: 'title_en', label: 'Title (EN)', type: 'text', required: true }, { key: 'title_ta', label: 'Title (TA)', type: 'text', required: true },
      { key: 'body_en', label: 'Body (EN)', type: 'textarea', required: true, list: false }, { key: 'body_ta', label: 'Body (TA)', type: 'textarea', required: true, list: false },
      { key: 'channels', label: 'Channels (IN_APP, SMS, WHATSAPP, EMAIL, PUSH)', type: 'array' }, { key: 'active', label: 'Active', type: 'bool' },
    ],
  },
  languages: {
    table: 'languages', title: 'Languages', perm: 'language.manage', pk: 'code', pkType: 'text', order: 'sort_order', search: ['name_en'],
    statusCol: { key: 'enabled', active: true, inactive: false },
    cols: [
      { key: 'code', label: 'Code', type: 'text', required: true, readOnlyOnEdit: true }, { key: 'name_en', label: 'Name', type: 'text', required: true }, { key: 'native_name', label: 'Native name', type: 'text', required: true },
      { key: 'short_label', label: 'Switcher label', type: 'text', required: true }, { key: 'speech_locale', label: 'Speech locale', type: 'text', required: true },
      { key: 'enabled', label: 'Enabled', type: 'bool' }, { key: 'sort_order', label: 'Order', type: 'number' },
    ],
  },
};
