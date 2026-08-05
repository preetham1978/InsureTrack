export type UserRole = 'team1_reviewer' | 'team2_verifier' | 'ops_admin' | 'client_viewer' | 'super_admin';

export interface User {
  id: string;
  email: string;
  role: UserRole;
  client_id: string | null;
  name: string;
  created_at: string;
  headers?: string[];
  field_mapping?: Record<string, string>;
  is_global?: boolean;
  assigned_client_ids?: string[];
}

export interface Client {
  id: string;
  name: string;
  code: string;
  created_at: string;
  headers?: string[];
  field_mapping?: Record<string, string>;
}

export interface ImportBatch {
  id: string;
  client_id: string;
  uploaded_by: string;
  filename: string;
  record_count: number;
  status: 'pending' | 'completed' | 'failed';
  created_at: string;
  headers?: string[];
  field_mapping?: Record<string, string>;
}

export interface Patient {
  id: string;
  client_id: string;
  first_name: string;
  last_name: string;
  dob: string;
  gender: string;
  created_at: string;
  headers?: string[];
  field_mapping?: Record<string, string>;
}

export interface Appointment {
  id: string;
  client_id: string;
  patient_id: string;
  appointment_date: string;
  provider_name: string;
  status: 'pending_review' | 'in_verification' | 'approved' | 'not_approved';
  created_at: string;
  headers?: string[];
  field_mapping?: Record<string, string>;
  updated_at: string;
  patient: {
    id: string;
    first_name: string;
    last_name: string;
    dob: string;
    gender: string;
  } | null;
  insurance: {
    id: string;
    carrier_name: string;
    policy_number_masked: string;
    policy_number_decrypted?: string;
    group_number: string;
    subscriber_name: string;
    subscriber_dob: string;
    relationship: string;
  } | null;
  calls_count: number;
}

export interface VerificationCall {
  id: string;
  appointment_id: string;
  verified_by: string;
  call_outcome: 'approved' | 'not_approved' | 'no_answer' | 'callback_needed';
  checklist: {
    activeStatus: boolean;
    coPayInfo: boolean;
    deductibleMet: boolean;
    priorAuthRequired: boolean;
  };
  notes: string;
  created_at: string;
  headers?: string[];
  field_mapping?: Record<string, string>;
}

export interface AuditLog {
  id: string;
  user_id: string;
  user_email: string;
  client_id: string | null;
  action: string;
  record_id: string;
  details: string;
  created_at: string;
  headers?: string[];
  field_mapping?: Record<string, string>;
}
