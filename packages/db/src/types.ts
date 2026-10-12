export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  billing: {
    Tables: {
      invoices: {
        Row: {
          amount_kobo: number
          billing_period_end: string | null
          billing_period_start: string | null
          created_at: string
          currency: string
          description: string | null
          id: string
          metadata: Json
          organisation_id: string
          paid_at: string | null
          paystack_reference: string | null
          status: string
          subscription_id: string | null
        }
        Insert: {
          amount_kobo: number
          billing_period_end?: string | null
          billing_period_start?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          metadata?: Json
          organisation_id: string
          paid_at?: string | null
          paystack_reference?: string | null
          status?: string
          subscription_id?: string | null
        }
        Update: {
          amount_kobo?: number
          billing_period_end?: string | null
          billing_period_start?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          metadata?: Json
          organisation_id?: string
          paid_at?: string | null
          paystack_reference?: string | null
          status?: string
          subscription_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "subscriptions"
            referencedColumns: ["id"]
          },
        ]
      }
      org_addon_subscriptions: {
        Row: {
          amount_kobo: number
          cancelled_at: string | null
          created_at: string
          current_period_end: string | null
          feature_key: string
          id: string
          last_event_id: string | null
          organisation_id: string
          paystack_customer_code: string | null
          paystack_subscription_code: string | null
          refunded_at: string | null
          started_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_kobo: number
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          feature_key: string
          id?: string
          last_event_id?: string | null
          organisation_id: string
          paystack_customer_code?: string | null
          paystack_subscription_code?: string | null
          refunded_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_kobo?: number
          cancelled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          feature_key?: string
          id?: string
          last_event_id?: string | null
          organisation_id?: string
          paystack_customer_code?: string | null
          paystack_subscription_code?: string | null
          refunded_at?: string | null
          started_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      org_feature_seats: {
        Row: {
          amount_paid_kobo: number | null
          assigned_at: string | null
          assigned_user_id: string | null
          feature_key: string
          id: string
          notes: string | null
          organisation_id: string
          paystack_reference: string | null
          purchased_at: string
          purchased_by: string | null
        }
        Insert: {
          amount_paid_kobo?: number | null
          assigned_at?: string | null
          assigned_user_id?: string | null
          feature_key: string
          id?: string
          notes?: string | null
          organisation_id: string
          paystack_reference?: string | null
          purchased_at?: string
          purchased_by?: string | null
        }
        Update: {
          amount_paid_kobo?: number | null
          assigned_at?: string | null
          assigned_user_id?: string | null
          feature_key?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          paystack_reference?: string | null
          purchased_at?: string
          purchased_by?: string | null
        }
        Relationships: []
      }
      org_feature_unlocks: {
        Row: {
          amount_paid_kobo: number | null
          feature_key: string
          id: string
          notes: string | null
          organisation_id: string
          paystack_reference: string | null
          revoked_at: string | null
          revoked_reason: string | null
          unlocked_at: string
          unlocked_by: string | null
        }
        Insert: {
          amount_paid_kobo?: number | null
          feature_key: string
          id?: string
          notes?: string | null
          organisation_id: string
          paystack_reference?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          unlocked_at?: string
          unlocked_by?: string | null
        }
        Update: {
          amount_paid_kobo?: number | null
          feature_key?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          paystack_reference?: string | null
          revoked_at?: string | null
          revoked_reason?: string | null
          unlocked_at?: string
          unlocked_by?: string | null
        }
        Relationships: []
      }
      payment_events: {
        Row: {
          amount_kobo: number | null
          created_at: string
          event_type: string
          id: string
          organisation_id: string | null
          payload: Json
          paystack_reference: string
          user_id: string | null
        }
        Insert: {
          amount_kobo?: number | null
          created_at?: string
          event_type: string
          id?: string
          organisation_id?: string | null
          payload?: Json
          paystack_reference: string
          user_id?: string | null
        }
        Update: {
          amount_kobo?: number | null
          created_at?: string
          event_type?: string
          id?: string
          organisation_id?: string | null
          payload?: Json
          paystack_reference?: string
          user_id?: string | null
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          amount_kobo: number
          billing_period: string
          cancelled_at: string | null
          created_at: string
          id: string
          last_payment_failure_at: string | null
          next_billing_date: string | null
          organisation_id: string
          paused_at: string | null
          payment_failure_count: number
          paystack_customer_code: string | null
          paystack_plan_code: string | null
          paystack_subscription_code: string | null
          status: string
          tier: string
          trial_ends_at: string | null
          updated_at: string
        }
        Insert: {
          amount_kobo?: number
          billing_period?: string
          cancelled_at?: string | null
          created_at?: string
          id?: string
          last_payment_failure_at?: string | null
          next_billing_date?: string | null
          organisation_id: string
          paused_at?: string | null
          payment_failure_count?: number
          paystack_customer_code?: string | null
          paystack_plan_code?: string | null
          paystack_subscription_code?: string | null
          status?: string
          tier?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Update: {
          amount_kobo?: number
          billing_period?: string
          cancelled_at?: string | null
          created_at?: string
          id?: string
          last_payment_failure_at?: string | null
          next_billing_date?: string | null
          organisation_id?: string
          paused_at?: string | null
          payment_failure_count?: number
          paystack_customer_code?: string | null
          paystack_plan_code?: string | null
          paystack_subscription_code?: string | null
          status?: string
          tier?: string
          trial_ends_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      usage_records: {
        Row: {
          id: string
          metric: string
          organisation_id: string
          recorded_at: string
          value: number
        }
        Insert: {
          id?: string
          metric: string
          organisation_id: string
          recorded_at?: string
          value: number
        }
        Update: {
          id?: string
          metric?: string
          organisation_id?: string
          recorded_at?: string
          value?: number
        }
        Relationships: []
      }
      user_mv_subscriptions: {
        Row: {
          created_at: string
          current_period_end: string | null
          disclaimer_accepted_at: string | null
          id: string
          last_event_id: string | null
          paystack_customer_code: string | null
          paystack_subscription_code: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          disclaimer_accepted_at?: string | null
          id?: string
          last_event_id?: string | null
          paystack_customer_code?: string | null
          paystack_subscription_code?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          disclaimer_accepted_at?: string | null
          id?: string
          last_event_id?: string | null
          paystack_customer_code?: string | null
          paystack_subscription_code?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  cable_schedule: {
    Tables: {
      cable_tags: {
        Row: {
          cable_id: string
          created_at: string
          end_position: string
          id: string
          notes: string | null
          organisation_id: string
          printed: boolean
          printed_at: string | null
          printed_by: string | null
          qr_payload: Json
          tag_text: string
        }
        Insert: {
          cable_id: string
          created_at?: string
          end_position: string
          id?: string
          notes?: string | null
          organisation_id: string
          printed?: boolean
          printed_at?: string | null
          printed_by?: string | null
          qr_payload: Json
          tag_text: string
        }
        Update: {
          cable_id?: string
          created_at?: string
          end_position?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          printed?: boolean
          printed_at?: string | null
          printed_by?: string | null
          qr_payload?: Json
          tag_text?: string
        }
        Relationships: [
          {
            foreignKeyName: "cable_tags_cable_id_fkey"
            columns: ["cable_id"]
            isOneToOne: false
            referencedRelation: "cables"
            referencedColumns: ["id"]
          },
        ]
      }
      cables: {
        Row: {
          ambient_temp_c: number
          armour: string | null
          cable_no: number
          conductor: string
          confirmation_evidence_url: string | null
          confirmation_notes: string | null
          confirmed_length_at: string | null
          confirmed_length_by: string | null
          confirmed_length_m: number | null
          confirmed_length_method: string | null
          cores: string
          created_at: string
          depth_mm: number | null
          derate_depth: number | null
          derate_grouping: number | null
          derate_temp: number | null
          derate_thermal: number | null
          derated_current_rating_a: number | null
          grouped_with: number
          grouping_arrangement: string
          id: string
          import_warning: boolean
          installation_method: string | null
          insulation: string
          length_status: string
          manual_override: boolean
          measured_length_at: string | null
          measured_length_by: string | null
          measured_length_m: number | null
          measured_length_method: string | null
          notes: string | null
          ohm_per_km: number | null
          organisation_id: string
          revision_id: string
          size_derived_from_load: boolean
          size_mm2: number
          standard: string | null
          supply_id: string
          tag_override: string | null
          thermal_resistivity_kmw: number
          updated_at: string
          x_per_km: number | null
        }
        Insert: {
          ambient_temp_c?: number
          armour?: string | null
          cable_no: number
          conductor: string
          confirmation_evidence_url?: string | null
          confirmation_notes?: string | null
          confirmed_length_at?: string | null
          confirmed_length_by?: string | null
          confirmed_length_m?: number | null
          confirmed_length_method?: string | null
          cores: string
          created_at?: string
          depth_mm?: number | null
          derate_depth?: number | null
          derate_grouping?: number | null
          derate_temp?: number | null
          derate_thermal?: number | null
          derated_current_rating_a?: number | null
          grouped_with?: number
          grouping_arrangement?: string
          id?: string
          import_warning?: boolean
          installation_method?: string | null
          insulation: string
          length_status?: string
          manual_override?: boolean
          measured_length_at?: string | null
          measured_length_by?: string | null
          measured_length_m?: number | null
          measured_length_method?: string | null
          notes?: string | null
          ohm_per_km?: number | null
          organisation_id: string
          revision_id: string
          size_derived_from_load?: boolean
          size_mm2: number
          standard?: string | null
          supply_id: string
          tag_override?: string | null
          thermal_resistivity_kmw?: number
          updated_at?: string
          x_per_km?: number | null
        }
        Update: {
          ambient_temp_c?: number
          armour?: string | null
          cable_no?: number
          conductor?: string
          confirmation_evidence_url?: string | null
          confirmation_notes?: string | null
          confirmed_length_at?: string | null
          confirmed_length_by?: string | null
          confirmed_length_m?: number | null
          confirmed_length_method?: string | null
          cores?: string
          created_at?: string
          depth_mm?: number | null
          derate_depth?: number | null
          derate_grouping?: number | null
          derate_temp?: number | null
          derate_thermal?: number | null
          derated_current_rating_a?: number | null
          grouped_with?: number
          grouping_arrangement?: string
          id?: string
          import_warning?: boolean
          installation_method?: string | null
          insulation?: string
          length_status?: string
          manual_override?: boolean
          measured_length_at?: string | null
          measured_length_by?: string | null
          measured_length_m?: number | null
          measured_length_method?: string | null
          notes?: string | null
          ohm_per_km?: number | null
          organisation_id?: string
          revision_id?: string
          size_derived_from_load?: boolean
          size_mm2?: number
          standard?: string | null
          supply_id?: string
          tag_override?: string | null
          thermal_resistivity_kmw?: number
          updated_at?: string
          x_per_km?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cables_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cables_supply_id_fkey"
            columns: ["supply_id"]
            isOneToOne: false
            referencedRelation: "supplies"
            referencedColumns: ["id"]
          },
        ]
      }
      change_log: {
        Row: {
          changed_at: string
          changed_by: string | null
          entity_id: string | null
          entity_type: string
          field_name: string | null
          id: string
          new_value: Json | null
          old_value: Json | null
          organisation_id: string
          reason: string | null
          revision_id: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          entity_id?: string | null
          entity_type: string
          field_name?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          organisation_id: string
          reason?: string | null
          revision_id: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          entity_id?: string | null
          entity_type?: string
          field_name?: string | null
          id?: string
          new_value?: Json | null
          old_value?: Json | null
          organisation_id?: string
          reason?: string | null
          revision_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "change_log_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      cost_lines: {
        Row: {
          conductor: string
          contingency_pct: number | null
          created_at: string
          id: string
          install_rate_per_m: number
          notes: string | null
          organisation_id: string
          revision_id: string
          size_mm2: number
          supply_rate_per_m: number
          termination_rate_each: number
          updated_at: string
          vat_pct: number | null
        }
        Insert: {
          conductor?: string
          contingency_pct?: number | null
          created_at?: string
          id?: string
          install_rate_per_m?: number
          notes?: string | null
          organisation_id: string
          revision_id: string
          size_mm2: number
          supply_rate_per_m?: number
          termination_rate_each?: number
          updated_at?: string
          vat_pct?: number | null
        }
        Update: {
          conductor?: string
          contingency_pct?: number | null
          created_at?: string
          id?: string
          install_rate_per_m?: number
          notes?: string | null
          organisation_id?: string
          revision_id?: string
          size_mm2?: number
          supply_rate_per_m?: number
          termination_rate_each?: number
          updated_at?: string
          vat_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "cost_lines_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      discrimination_checks: {
        Row: {
          at_fault_a: number
          computed_at: string
          downstream_device_id: string
          id: string
          margin_ms: number | null
          organisation_id: string
          revision_id: string
          t_down_s: number | null
          t_up_s: number | null
          upstream_device_id: string
          verdict: string
        }
        Insert: {
          at_fault_a: number
          computed_at?: string
          downstream_device_id: string
          id?: string
          margin_ms?: number | null
          organisation_id: string
          revision_id: string
          t_down_s?: number | null
          t_up_s?: number | null
          upstream_device_id: string
          verdict: string
        }
        Update: {
          at_fault_a?: number
          computed_at?: string
          downstream_device_id?: string
          id?: string
          margin_ms?: number | null
          organisation_id?: string
          revision_id?: string
          t_down_s?: number | null
          t_up_s?: number | null
          upstream_device_id?: string
          verdict?: string
        }
        Relationships: [
          {
            foreignKeyName: "discrimination_checks_downstream_device_id_fkey"
            columns: ["downstream_device_id"]
            isOneToOne: false
            referencedRelation: "protection_devices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrimination_checks_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discrimination_checks_upstream_device_id_fkey"
            columns: ["upstream_device_id"]
            isOneToOne: false
            referencedRelation: "protection_devices"
            referencedColumns: ["id"]
          },
        ]
      }
      fault_results: {
        Row: {
          basis: string | null
          computed_at: string
          ic_amps: number | null
          id: string
          ik1_max_ka: number | null
          ik1_min_ka: number | null
          ik3_max_ka: number | null
          ik3_min_ka: number | null
          ip_ka: number | null
          node_id: string
          organisation_id: string
          revision_id: string
          xr_ratio: number | null
        }
        Insert: {
          basis?: string | null
          computed_at?: string
          ic_amps?: number | null
          id?: string
          ik1_max_ka?: number | null
          ik1_min_ka?: number | null
          ik3_max_ka?: number | null
          ik3_min_ka?: number | null
          ip_ka?: number | null
          node_id: string
          organisation_id: string
          revision_id: string
          xr_ratio?: number | null
        }
        Update: {
          basis?: string | null
          computed_at?: string
          ic_amps?: number | null
          id?: string
          ik1_max_ka?: number | null
          ik1_min_ka?: number | null
          ik3_max_ka?: number | null
          ik3_min_ka?: number | null
          ip_ka?: number | null
          node_id?: string
          organisation_id?: string
          revision_id?: string
          xr_ratio?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fault_results_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      fault_sources: {
        Row: {
          created_at: string
          current_limit_factor: number | null
          id: string
          lv_earthing_kind: string | null
          lv_earthing_ohm: number | null
          node_id: string | null
          organisation_id: string
          pkr_w: number | null
          revision_id: string
          role: string
          s_rated_va: number | null
          source_id: string | null
          ssc_mva: number | null
          uk_pct: number | null
          updated_at: string
          vector_group: string | null
          xd_pct: number | null
          xr_ratio: number | null
          z0_over_z1: number | null
        }
        Insert: {
          created_at?: string
          current_limit_factor?: number | null
          id?: string
          lv_earthing_kind?: string | null
          lv_earthing_ohm?: number | null
          node_id?: string | null
          organisation_id: string
          pkr_w?: number | null
          revision_id: string
          role: string
          s_rated_va?: number | null
          source_id?: string | null
          ssc_mva?: number | null
          uk_pct?: number | null
          updated_at?: string
          vector_group?: string | null
          xd_pct?: number | null
          xr_ratio?: number | null
          z0_over_z1?: number | null
        }
        Update: {
          created_at?: string
          current_limit_factor?: number | null
          id?: string
          lv_earthing_kind?: string | null
          lv_earthing_ohm?: number | null
          node_id?: string | null
          organisation_id?: string
          pkr_w?: number | null
          revision_id?: string
          role?: string
          s_rated_va?: number | null
          source_id?: string | null
          ssc_mva?: number | null
          uk_pct?: number | null
          updated_at?: string
          vector_group?: string | null
          xd_pct?: number | null
          xr_ratio?: number | null
          z0_over_z1?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fault_sources_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fault_sources_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
        ]
      }
      mv_study_settings: {
        Row: {
          base_mva: number
          c_max: number
          c_min: number
          created_at: string
          ef_fault_resistance_ohm: number
          frequency_hz: number
          id: string
          organisation_id: string
          revision_id: string
          updated_at: string
        }
        Insert: {
          base_mva?: number
          c_max?: number
          c_min?: number
          created_at?: string
          ef_fault_resistance_ohm?: number
          frequency_hz?: number
          id?: string
          organisation_id: string
          revision_id: string
          updated_at?: string
        }
        Update: {
          base_mva?: number
          c_max?: number
          c_min?: number
          created_at?: string
          ef_fault_resistance_ohm?: number
          frequency_hz?: number
          id?: string
          organisation_id?: string
          revision_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mv_study_settings_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: true
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      mv_study_signoff: {
        Row: {
          created_at: string
          curve_manual_rev: string | null
          id: string
          organisation_id: string
          pr_eng_ecsa_reg: string | null
          pr_eng_name: string | null
          revision_id: string
          signed_off_at: string | null
          signed_off_by: string | null
          source_data_confirmed: boolean
          updated_at: string
          validation_pack_ref: string | null
        }
        Insert: {
          created_at?: string
          curve_manual_rev?: string | null
          id?: string
          organisation_id: string
          pr_eng_ecsa_reg?: string | null
          pr_eng_name?: string | null
          revision_id: string
          signed_off_at?: string | null
          signed_off_by?: string | null
          source_data_confirmed?: boolean
          updated_at?: string
          validation_pack_ref?: string | null
        }
        Update: {
          created_at?: string
          curve_manual_rev?: string | null
          id?: string
          organisation_id?: string
          pr_eng_ecsa_reg?: string | null
          pr_eng_name?: string | null
          revision_id?: string
          signed_off_at?: string | null
          signed_off_by?: string | null
          source_data_confirmed?: boolean
          updated_at?: string
          validation_pack_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mv_study_signoff_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: true
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      protection_devices: {
        Row: {
          created_at: string
          created_by: string | null
          curve_ref: string | null
          device_role: string
          device_type: string
          frame_rating_a: number | null
          id: string
          manufacturer: string | null
          model: string | null
          node_id: string | null
          organisation_id: string
          revision_id: string
          settings: Json
          supply_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          curve_ref?: string | null
          device_role: string
          device_type: string
          frame_rating_a?: number | null
          id?: string
          manufacturer?: string | null
          model?: string | null
          node_id?: string | null
          organisation_id: string
          revision_id: string
          settings?: Json
          supply_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          curve_ref?: string | null
          device_role?: string
          device_type?: string
          frame_rating_a?: number | null
          id?: string
          manufacturer?: string | null
          model?: string | null
          node_id?: string | null
          organisation_id?: string
          revision_id?: string
          settings?: Json
          supply_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "protection_devices_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "protection_devices_supply_id_fkey"
            columns: ["supply_id"]
            isOneToOne: false
            referencedRelation: "supplies"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_library: {
        Row: {
          conductor: string
          id: string
          install_rate_per_m: number
          notes: string | null
          organisation_id: string
          project_id: string
          size_mm2: number
          supply_rate_per_m: number
          termination_rate_each: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          conductor: string
          id?: string
          install_rate_per_m?: number
          notes?: string | null
          organisation_id: string
          project_id: string
          size_mm2: number
          supply_rate_per_m?: number
          termination_rate_each?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          conductor?: string
          id?: string
          install_rate_per_m?: number
          notes?: string | null
          organisation_id?: string
          project_id?: string
          size_mm2?: number
          supply_rate_per_m?: number
          termination_rate_each?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      revisions: {
        Row: {
          change_notes: string | null
          code: string
          created_at: string
          created_by: string | null
          description: string | null
          fault_level_ka: number | null
          id: string
          issued_at: string | null
          issued_by: string | null
          organisation_id: string
          project_id: string
          status: string
          updated_at: string
          vat_pct: number | null
        }
        Insert: {
          change_notes?: string | null
          code: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          fault_level_ka?: number | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          organisation_id: string
          project_id: string
          status?: string
          updated_at?: string
          vat_pct?: number | null
        }
        Update: {
          change_notes?: string | null
          code?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          fault_level_ka?: number | null
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          organisation_id?: string
          project_id?: string
          status?: string
          updated_at?: string
          vat_pct?: number | null
        }
        Relationships: []
      }
      route_history: {
        Row: {
          drop_m: number
          id: string
          organisation_id: string
          reason: string
          revision_id: string
          rise_m: number
          route_id: string
          saved_at: string
          saved_by: string
          snapshot: Json
          supply_id: string
        }
        Insert: {
          drop_m?: number
          id?: string
          organisation_id: string
          reason?: string
          revision_id: string
          rise_m?: number
          route_id: string
          saved_at?: string
          saved_by: string
          snapshot: Json
          supply_id: string
        }
        Update: {
          drop_m?: number
          id?: string
          organisation_id?: string
          reason?: string
          revision_id?: string
          rise_m?: number
          route_id?: string
          saved_at?: string
          saved_by?: string
          snapshot?: Json
          supply_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "route_history_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "route_history_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "supply_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      route_segments: {
        Row: {
          created_at: string
          floor_plan_id: string | null
          floor_plan_name: string
          id: string
          length_m: number
          organisation_id: string
          page_index: number
          pixels_per_meter: number
          points: Json
          route_id: string
          seq: number
        }
        Insert: {
          created_at?: string
          floor_plan_id?: string | null
          floor_plan_name: string
          id?: string
          length_m: number
          organisation_id: string
          page_index?: number
          pixels_per_meter: number
          points: Json
          route_id: string
          seq: number
        }
        Update: {
          created_at?: string
          floor_plan_id?: string | null
          floor_plan_name?: string
          id?: string
          length_m?: number
          organisation_id?: string
          page_index?: number
          pixels_per_meter?: number
          points?: Json
          route_id?: string
          seq?: number
        }
        Relationships: [
          {
            foreignKeyName: "route_segments_route_id_fkey"
            columns: ["route_id"]
            isOneToOne: false
            referencedRelation: "supply_routes"
            referencedColumns: ["id"]
          },
        ]
      }
      sans_overrides: {
        Row: {
          columns: Json
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          organisation_id: string
          project_id: string
          rows: Json
          source_ref: string | null
          table_code: string
          updated_at: string
        }
        Insert: {
          columns: Json
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organisation_id: string
          project_id: string
          rows: Json
          source_ref?: string | null
          table_code: string
          updated_at?: string
        }
        Update: {
          columns?: Json
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organisation_id?: string
          project_id?: string
          rows?: Json
          source_ref?: string | null
          table_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      sans_rows: {
        Row: {
          created_at: string
          id: string
          row_data: Json
          sort_key: number
          table_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          row_data: Json
          sort_key: number
          table_id: string
        }
        Update: {
          created_at?: string
          id?: string
          row_data?: Json
          sort_key?: number
          table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sans_rows_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "sans_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      sans_tables: {
        Row: {
          applicable_to: Json | null
          cable_construction: string | null
          category: string | null
          code: string
          columns: Json
          created_at: string
          description: string | null
          id: string
          notes: string | null
          section_number: string | null
          source_ref: string | null
          standard: string
          title: string
          updated_at: string
        }
        Insert: {
          applicable_to?: Json | null
          cable_construction?: string | null
          category?: string | null
          code: string
          columns: Json
          created_at?: string
          description?: string | null
          id?: string
          notes?: string | null
          section_number?: string | null
          source_ref?: string | null
          standard: string
          title: string
          updated_at?: string
        }
        Update: {
          applicable_to?: Json | null
          cable_construction?: string | null
          category?: string | null
          code?: string
          columns?: Json
          created_at?: string
          description?: string | null
          id?: string
          notes?: string | null
          section_number?: string | null
          source_ref?: string | null
          standard?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      sources: {
        Row: {
          code: string
          created_at: string
          id: string
          notes: string | null
          organisation_id: string
          rating_kva: number | null
          revision_id: string
          type: string
          updated_at: string
          voltage_v: number | null
        }
        Insert: {
          code: string
          created_at?: string
          id?: string
          notes?: string | null
          organisation_id: string
          rating_kva?: number | null
          revision_id: string
          type: string
          updated_at?: string
          voltage_v?: number | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          rating_kva?: number | null
          revision_id?: string
          type?: string
          updated_at?: string
          voltage_v?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "sources_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      supplies: {
        Row: {
          created_at: string
          design_load_a: number
          from_node_id: string | null
          from_source_id: string | null
          id: string
          notes: string | null
          organisation_id: string
          revision_id: string
          section: string | null
          to_node_id: string
          updated_at: string
          voltage_v: number
        }
        Insert: {
          created_at?: string
          design_load_a: number
          from_node_id?: string | null
          from_source_id?: string | null
          id?: string
          notes?: string | null
          organisation_id: string
          revision_id: string
          section?: string | null
          to_node_id: string
          updated_at?: string
          voltage_v: number
        }
        Update: {
          created_at?: string
          design_load_a?: number
          from_node_id?: string | null
          from_source_id?: string | null
          id?: string
          notes?: string | null
          organisation_id?: string
          revision_id?: string
          section?: string | null
          to_node_id?: string
          updated_at?: string
          voltage_v?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplies_from_source_id_fkey"
            columns: ["from_source_id"]
            isOneToOne: false
            referencedRelation: "sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplies_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
        ]
      }
      supply_routes: {
        Row: {
          created_at: string
          drop_m: number
          id: string
          measured_at: string | null
          measured_by: string | null
          notes: string | null
          organisation_id: string
          revision_id: string
          rise_m: number
          supply_id: string
          total_length_m: number | null
          traced_length_m: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          drop_m?: number
          id?: string
          measured_at?: string | null
          measured_by?: string | null
          notes?: string | null
          organisation_id: string
          revision_id: string
          rise_m?: number
          supply_id: string
          total_length_m?: number | null
          traced_length_m?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          drop_m?: number
          id?: string
          measured_at?: string | null
          measured_by?: string | null
          notes?: string | null
          organisation_id?: string
          revision_id?: string
          rise_m?: number
          supply_id?: string
          total_length_m?: number | null
          traced_length_m?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "supply_routes_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supply_routes_supply_id_fkey"
            columns: ["supply_id"]
            isOneToOne: true
            referencedRelation: "supplies"
            referencedColumns: ["id"]
          },
        ]
      }
      terminations: {
        Row: {
          cable_id: string
          created_at: string
          end_position: string
          gland_type: string | null
          id: string
          lug_size_mm2: number | null
          notes: string | null
          organisation_id: string
        }
        Insert: {
          cable_id: string
          created_at?: string
          end_position: string
          gland_type?: string | null
          id?: string
          lug_size_mm2?: number | null
          notes?: string | null
          organisation_id: string
        }
        Update: {
          cable_id?: string
          created_at?: string
          end_position?: string
          gland_type?: string | null
          id?: string
          lug_size_mm2?: number | null
          notes?: string | null
          organisation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "terminations_cable_id_fkey"
            columns: ["cable_id"]
            isOneToOne: false
            referencedRelation: "cables"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      user_can_edit_cable: { Args: { p_cable_id: string }; Returns: boolean }
      user_can_edit_project: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      user_can_edit_revision: {
        Args: { p_revision_id: string }
        Returns: boolean
      }
      user_can_edit_schedule: {
        Args: { p_organisation_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  field: {
    Tables: {
      cables: {
        Row: {
          cable_type: string | null
          circuit_ref: string
          conductor_size: string | null
          created_at: string
          created_by: string | null
          description: string | null
          from_location: string | null
          id: string
          length_m: number | null
          notes: string | null
          organisation_id: string
          project_id: string
          protection: string | null
          to_location: string | null
          updated_at: string
        }
        Insert: {
          cable_type?: string | null
          circuit_ref: string
          conductor_size?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          from_location?: string | null
          id?: string
          length_m?: number | null
          notes?: string | null
          organisation_id: string
          project_id: string
          protection?: string | null
          to_location?: string | null
          updated_at?: string
        }
        Update: {
          cable_type?: string | null
          circuit_ref?: string
          conductor_size?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          from_location?: string | null
          id?: string
          length_m?: number | null
          notes?: string | null
          organisation_id?: string
          project_id?: string
          protection?: string | null
          to_location?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      form_number_seqs: {
        Row: {
          last_no: number
          prefix: string
          project_id: string
          year: number
        }
        Insert: {
          last_no?: number
          prefix: string
          project_id: string
          year: number
        }
        Update: {
          last_no?: number
          prefix?: string
          project_id?: string
          year?: number
        }
        Relationships: []
      }
      form_photos: {
        Row: {
          caption: string | null
          created_at: string
          field_id: string
          file_size_bytes: number | null
          form_id: string
          gps_lat: number | null
          gps_lng: number | null
          height_px: number | null
          id: string
          section_id: string
          sort_order: number
          storage_path: string
          taken_at: string | null
          uploaded_by: string | null
          width_px: number | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          field_id: string
          file_size_bytes?: number | null
          form_id: string
          gps_lat?: number | null
          gps_lng?: number | null
          height_px?: number | null
          id?: string
          section_id: string
          sort_order?: number
          storage_path: string
          taken_at?: string | null
          uploaded_by?: string | null
          width_px?: number | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          field_id?: string
          file_size_bytes?: number | null
          form_id?: string
          gps_lat?: number | null
          gps_lng?: number | null
          height_px?: number | null
          id?: string
          section_id?: string
          sort_order?: number
          storage_path?: string
          taken_at?: string | null
          uploaded_by?: string | null
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "form_photos_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "site_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      form_response_history: {
        Row: {
          fail_reason: string | null
          field_id: string
          form_id: string
          id: string
          pass_state: string | null
          prefilled_from: string | null
          responded_at: string
          responded_by: string | null
          section_id: string
          value_array: string[] | null
          value_bool: boolean | null
          value_json: Json | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          fail_reason?: string | null
          field_id: string
          form_id: string
          id?: string
          pass_state?: string | null
          prefilled_from?: string | null
          responded_at?: string
          responded_by?: string | null
          section_id: string
          value_array?: string[] | null
          value_bool?: boolean | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          fail_reason?: string | null
          field_id?: string
          form_id?: string
          id?: string
          pass_state?: string | null
          prefilled_from?: string | null
          responded_at?: string
          responded_by?: string | null
          section_id?: string
          value_array?: string[] | null
          value_bool?: boolean | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_response_history_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "site_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      form_responses: {
        Row: {
          fail_reason: string | null
          field_id: string
          form_id: string
          id: string
          latest_responded_at: string
          latest_responded_by: string | null
          pass_state: string | null
          prefilled_from: string | null
          section_id: string
          value_array: string[] | null
          value_bool: boolean | null
          value_json: Json | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          fail_reason?: string | null
          field_id: string
          form_id: string
          id?: string
          latest_responded_at?: string
          latest_responded_by?: string | null
          pass_state?: string | null
          prefilled_from?: string | null
          section_id: string
          value_array?: string[] | null
          value_bool?: boolean | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          fail_reason?: string | null
          field_id?: string
          form_id?: string
          id?: string
          latest_responded_at?: string
          latest_responded_by?: string | null
          pass_state?: string | null
          prefilled_from?: string | null
          section_id?: string
          value_array?: string[] | null
          value_bool?: boolean | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "form_responses_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "site_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      form_signatures: {
        Row: {
          block_id: string
          form_id: string
          id: string
          registration_category: string | null
          registration_number: string | null
          signatory_name: string
          signatory_role: string | null
          signed_at: string
          signed_by: string | null
          storage_path: string
        }
        Insert: {
          block_id: string
          form_id: string
          id?: string
          registration_category?: string | null
          registration_number?: string | null
          signatory_name: string
          signatory_role?: string | null
          signed_at?: string
          signed_by?: string | null
          storage_path: string
        }
        Update: {
          block_id?: string
          form_id?: string
          id?: string
          registration_category?: string | null
          registration_number?: string | null
          signatory_name?: string
          signatory_role?: string | null
          signed_at?: string
          signed_by?: string | null
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "form_signatures_form_id_fkey"
            columns: ["form_id"]
            isOneToOne: false
            referencedRelation: "site_forms"
            referencedColumns: ["id"]
          },
        ]
      }
      form_templates: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          organisation_id: string | null
          schema_json: Json
          template_key: string
          updated_at: string
          version: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          organisation_id?: string | null
          schema_json: Json
          template_key: string
          updated_at?: string
          version: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          organisation_id?: string | null
          schema_json?: Json
          template_key?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      inspection_milestones: {
        Row: {
          completed_date: string | null
          created_at: string
          description: string | null
          id: string
          inspector_id: string | null
          name: string
          notes: string | null
          organisation_id: string
          project_id: string
          scheduled_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          completed_date?: string | null
          created_at?: string
          description?: string | null
          id?: string
          inspector_id?: string | null
          name: string
          notes?: string | null
          organisation_id: string
          project_id: string
          scheduled_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          completed_date?: string | null
          created_at?: string
          description?: string | null
          id?: string
          inspector_id?: string | null
          name?: string
          notes?: string | null
          organisation_id?: string
          project_id?: string
          scheduled_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      inspection_requests: {
        Row: {
          authority: string
          confirmed_date: string | null
          created_at: string
          id: string
          milestone_id: string | null
          organisation_id: string
          outcome: string | null
          outcome_notes: string | null
          project_id: string
          requested_by: string
          requested_date: string | null
          updated_at: string
        }
        Insert: {
          authority: string
          confirmed_date?: string | null
          created_at?: string
          id?: string
          milestone_id?: string | null
          organisation_id: string
          outcome?: string | null
          outcome_notes?: string | null
          project_id: string
          requested_by: string
          requested_date?: string | null
          updated_at?: string
        }
        Update: {
          authority?: string
          confirmed_date?: string | null
          created_at?: string
          id?: string
          milestone_id?: string | null
          organisation_id?: string
          outcome?: string | null
          outcome_notes?: string | null
          project_id?: string
          requested_by?: string
          requested_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inspection_requests_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "inspection_milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      site_forms: {
        Row: {
          as_left_status: string | null
          board_label: string | null
          board_ref: string | null
          created_at: string
          created_by: string
          distributed_at: string | null
          distributed_by: string | null
          form_no: string | null
          id: string
          node_id: string | null
          organisation_id: string
          project_id: string
          report_id: string | null
          status: string
          submitted_at: string | null
          submitted_by: string | null
          template_row_id: string
          updated_at: string
          void_reason: string | null
        }
        Insert: {
          as_left_status?: string | null
          board_label?: string | null
          board_ref?: string | null
          created_at?: string
          created_by?: string
          distributed_at?: string | null
          distributed_by?: string | null
          form_no?: string | null
          id?: string
          node_id?: string | null
          organisation_id: string
          project_id: string
          report_id?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          template_row_id: string
          updated_at?: string
          void_reason?: string | null
        }
        Update: {
          as_left_status?: string | null
          board_label?: string | null
          board_ref?: string | null
          created_at?: string
          created_by?: string
          distributed_at?: string | null
          distributed_by?: string | null
          form_no?: string | null
          id?: string
          node_id?: string | null
          organisation_id?: string
          project_id?: string
          report_id?: string | null
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          template_row_id?: string
          updated_at?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_forms_template_row_id_fkey"
            columns: ["template_row_id"]
            isOneToOne: false
            referencedRelation: "form_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      snag_photos: {
        Row: {
          caption: string | null
          created_at: string
          file_path: string
          id: string
          photo_type: string
          snag_id: string
          sort_order: number
          uploaded_by: string | null
          visit_id: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          file_path: string
          id?: string
          photo_type?: string
          snag_id: string
          sort_order?: number
          uploaded_by?: string | null
          visit_id?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          file_path?: string
          id?: string
          photo_type?: string
          snag_id?: string
          sort_order?: number
          uploaded_by?: string | null
          visit_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "snag_photos_snag_id_fkey"
            columns: ["snag_id"]
            isOneToOne: false
            referencedRelation: "snags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "snag_photos_visit_fk"
            columns: ["visit_id"]
            isOneToOne: false
            referencedRelation: "snag_visits"
            referencedColumns: ["id"]
          },
        ]
      }
      snag_visits: {
        Row: {
          attendees: Json
          completed_at: string | null
          completed_by: string | null
          conducted_by: string
          created_at: string
          id: string
          is_backlog: boolean
          notes: string | null
          organisation_id: string
          project_id: string
          report_id: string | null
          title: string | null
          updated_at: string
          visit_date: string
          visit_no: number
        }
        Insert: {
          attendees?: Json
          completed_at?: string | null
          completed_by?: string | null
          conducted_by: string
          created_at?: string
          id?: string
          is_backlog?: boolean
          notes?: string | null
          organisation_id: string
          project_id: string
          report_id?: string | null
          title?: string | null
          updated_at?: string
          visit_date: string
          visit_no?: number
        }
        Update: {
          attendees?: Json
          completed_at?: string | null
          completed_by?: string | null
          conducted_by?: string
          created_at?: string
          id?: string
          is_backlog?: boolean
          notes?: string | null
          organisation_id?: string
          project_id?: string
          report_id?: string | null
          title?: string | null
          updated_at?: string
          visit_date?: string
          visit_no?: number
        }
        Relationships: []
      }
      snags: {
        Row: {
          assigned_to: string | null
          category: string
          closed_on_visit_id: string | null
          created_at: string
          description: string | null
          floor_plan_pin: Json | null
          id: string
          location: string | null
          organisation_id: string
          priority: string
          project_id: string
          raised_by: string
          raised_on_visit_id: string | null
          resolved_at: string | null
          signature_path: string | null
          signed_off_at: string | null
          signed_off_by: string | null
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string
          closed_on_visit_id?: string | null
          created_at?: string
          description?: string | null
          floor_plan_pin?: Json | null
          id?: string
          location?: string | null
          organisation_id: string
          priority?: string
          project_id: string
          raised_by: string
          raised_on_visit_id?: string | null
          resolved_at?: string | null
          signature_path?: string | null
          signed_off_at?: string | null
          signed_off_by?: string | null
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string
          closed_on_visit_id?: string | null
          created_at?: string
          description?: string | null
          floor_plan_pin?: Json | null
          id?: string
          location?: string | null
          organisation_id?: string
          priority?: string
          project_id?: string
          raised_by?: string
          raised_on_visit_id?: string | null
          resolved_at?: string | null
          signature_path?: string | null
          signed_off_at?: string | null
          signed_off_by?: string | null
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "snags_closed_on_visit_fk"
            columns: ["project_id", "closed_on_visit_id"]
            isOneToOne: false
            referencedRelation: "snag_visits"
            referencedColumns: ["project_id", "id"]
          },
          {
            foreignKeyName: "snags_raised_on_visit_fk"
            columns: ["project_id", "raised_on_visit_id"]
            isOneToOne: false
            referencedRelation: "snag_visits"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allocate_form_no: {
        Args: { p_form_id: string; p_prefix: string }
        Returns: string
      }
      safe_form_uuid: { Args: { p_txt: string }; Returns: string }
      user_can_manage_form: { Args: { p_project_id: string }; Returns: boolean }
      user_can_write_form: { Args: { p_form_id: string }; Returns: boolean }
      user_has_form_read: { Args: { p_form_id: string }; Returns: boolean }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  inspections: {
    Tables: {
      certificates: {
        Row: {
          coc_number: string
          generated_at: string
          generated_by: string
          id: string
          inspection_id: string
          revoke_reason: string | null
          revoked_at: string | null
          revoked_by: string | null
          share_expires_at: string | null
          share_token: string | null
          storage_path: string
          superseded_at: string | null
        }
        Insert: {
          coc_number: string
          generated_at?: string
          generated_by: string
          id?: string
          inspection_id: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          share_expires_at?: string | null
          share_token?: string | null
          storage_path: string
          superseded_at?: string | null
        }
        Update: {
          coc_number?: string
          generated_at?: string
          generated_by?: string
          id?: string
          inspection_id?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          revoked_by?: string | null
          share_expires_at?: string | null
          share_token?: string | null
          storage_path?: string
          superseded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "certificates_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      coc_number_seqs: {
        Row: {
          last_seq: number
          prefix: string
          project_id: string
          year: number
        }
        Insert: {
          last_seq?: number
          prefix: string
          project_id: string
          year: number
        }
        Update: {
          last_seq?: number
          prefix?: string
          project_id?: string
          year?: number
        }
        Relationships: []
      }
      coc_validations: {
        Row: {
          certificate_id: string | null
          failure_reason: string | null
          id: string
          inspection_id: string
          measured_value: string | null
          result: string
          rule_code: string
          rule_label: string
          sans_clause: string | null
          threshold: string | null
          validated_at: string
          validator_version: string
        }
        Insert: {
          certificate_id?: string | null
          failure_reason?: string | null
          id?: string
          inspection_id: string
          measured_value?: string | null
          result: string
          rule_code: string
          rule_label: string
          sans_clause?: string | null
          threshold?: string | null
          validated_at?: string
          validator_version?: string
        }
        Update: {
          certificate_id?: string | null
          failure_reason?: string | null
          id?: string
          inspection_id?: string
          measured_value?: string | null
          result?: string
          rule_code?: string
          rule_label?: string
          sans_clause?: string | null
          threshold?: string | null
          validated_at?: string
          validator_version?: string
        }
        Relationships: [
          {
            foreignKeyName: "coc_validations_certificate_id_fkey"
            columns: ["certificate_id"]
            isOneToOne: false
            referencedRelation: "certificates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "coc_validations_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      inspections: {
        Row: {
          abandon_reason: string | null
          abandoned_at: string | null
          abandoned_by: string | null
          abandoned_reason: string | null
          assigned_to_id: string | null
          certified_at: string | null
          coc_number: string | null
          completed_at: string | null
          created_at: string
          created_by: string
          id: string
          organisation_id: string
          overall_result: string | null
          parent_inspection_id: string | null
          project_id: string
          reinspection_notes: string | null
          scheduled_at: string | null
          started_at: string | null
          status: string
          target_label: string
          target_location: string | null
          target_node_id: string | null
          target_node_type: string
          template_id: string
          updated_at: string
          verifier_id: string | null
        }
        Insert: {
          abandon_reason?: string | null
          abandoned_at?: string | null
          abandoned_by?: string | null
          abandoned_reason?: string | null
          assigned_to_id?: string | null
          certified_at?: string | null
          coc_number?: string | null
          completed_at?: string | null
          created_at?: string
          created_by: string
          id?: string
          organisation_id: string
          overall_result?: string | null
          parent_inspection_id?: string | null
          project_id: string
          reinspection_notes?: string | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          target_label: string
          target_location?: string | null
          target_node_id?: string | null
          target_node_type: string
          template_id: string
          updated_at?: string
          verifier_id?: string | null
        }
        Update: {
          abandon_reason?: string | null
          abandoned_at?: string | null
          abandoned_by?: string | null
          abandoned_reason?: string | null
          assigned_to_id?: string | null
          certified_at?: string | null
          coc_number?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string
          id?: string
          organisation_id?: string
          overall_result?: string | null
          parent_inspection_id?: string | null
          project_id?: string
          reinspection_notes?: string | null
          scheduled_at?: string | null
          started_at?: string | null
          status?: string
          target_label?: string
          target_location?: string | null
          target_node_id?: string | null
          target_node_type?: string
          template_id?: string
          updated_at?: string
          verifier_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "inspections_parent_inspection_id_fkey"
            columns: ["parent_inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "inspections_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "templates"
            referencedColumns: ["id"]
          },
        ]
      }
      photos: {
        Row: {
          caption: string | null
          created_at: string
          field_id: string
          file_size_bytes: number | null
          gps_lat: number | null
          gps_lng: number | null
          height_px: number | null
          id: string
          inspection_id: string
          original_path: string | null
          original_size_bytes: number | null
          section_id: string
          storage_path: string
          taken_at: string | null
          uploaded_by: string
          width_px: number | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          field_id: string
          file_size_bytes?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          height_px?: number | null
          id?: string
          inspection_id: string
          original_path?: string | null
          original_size_bytes?: number | null
          section_id: string
          storage_path: string
          taken_at?: string | null
          uploaded_by?: string
          width_px?: number | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          field_id?: string
          file_size_bytes?: number | null
          gps_lat?: number | null
          gps_lng?: number | null
          height_px?: number | null
          id?: string
          inspection_id?: string
          original_path?: string | null
          original_size_bytes?: number | null
          section_id?: string
          storage_path?: string
          taken_at?: string | null
          uploaded_by?: string
          width_px?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "photos_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      response_history: {
        Row: {
          fail_reason: string | null
          field_id: string
          id: string
          inspection_id: string
          pass_state: string | null
          responded_at: string
          responded_by: string
          section_id: string
          value_array: string[] | null
          value_bool: boolean | null
          value_json: Json | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          fail_reason?: string | null
          field_id: string
          id?: string
          inspection_id: string
          pass_state?: string | null
          responded_at?: string
          responded_by: string
          section_id: string
          value_array?: string[] | null
          value_bool?: boolean | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          fail_reason?: string | null
          field_id?: string
          id?: string
          inspection_id?: string
          pass_state?: string | null
          responded_at?: string
          responded_by?: string
          section_id?: string
          value_array?: string[] | null
          value_bool?: boolean | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "response_history_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      responses: {
        Row: {
          fail_reason: string | null
          field_id: string
          id: string
          inspection_id: string
          latest_responded_at: string
          latest_responded_by: string
          pass_state: string | null
          section_id: string
          value_array: string[] | null
          value_bool: boolean | null
          value_json: Json | null
          value_number: number | null
          value_text: string | null
        }
        Insert: {
          fail_reason?: string | null
          field_id: string
          id?: string
          inspection_id: string
          latest_responded_at?: string
          latest_responded_by: string
          pass_state?: string | null
          section_id: string
          value_array?: string[] | null
          value_bool?: boolean | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Update: {
          fail_reason?: string | null
          field_id?: string
          id?: string
          inspection_id?: string
          latest_responded_at?: string
          latest_responded_by?: string
          pass_state?: string | null
          section_id?: string
          value_array?: string[] | null
          value_bool?: boolean | null
          value_json?: Json | null
          value_number?: number | null
          value_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "responses_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      signatures: {
        Row: {
          field_id: string | null
          id: string
          inspection_id: string
          registration_number: string | null
          role: string
          section_id: string | null
          signatory_name: string
          signatory_title: string | null
          signed_at: string
          signed_by: string
          storage_path: string
        }
        Insert: {
          field_id?: string | null
          id?: string
          inspection_id: string
          registration_number?: string | null
          role: string
          section_id?: string | null
          signatory_name: string
          signatory_title?: string | null
          signed_at?: string
          signed_by?: string
          storage_path: string
        }
        Update: {
          field_id?: string | null
          id?: string
          inspection_id?: string
          registration_number?: string | null
          role?: string
          section_id?: string | null
          signatory_name?: string
          signatory_title?: string | null
          signed_at?: string
          signed_by?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "signatures_inspection_id_fkey"
            columns: ["inspection_id"]
            isOneToOne: false
            referencedRelation: "inspections"
            referencedColumns: ["id"]
          },
        ]
      }
      templates: {
        Row: {
          applies_to_node_types: string[]
          category: string | null
          created_at: string
          created_by: string | null
          deliverable_type: string
          description: string | null
          id: string
          is_active: boolean
          name: string
          node_subtypes: string[] | null
          organisation_id: string | null
          sans_reference: string | null
          schema_json: Json
          template_id: string
          updated_at: string
          version: string
        }
        Insert: {
          applies_to_node_types: string[]
          category?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_type: string
          description?: string | null
          id?: string
          is_active?: boolean
          name: string
          node_subtypes?: string[] | null
          organisation_id?: string | null
          sans_reference?: string | null
          schema_json: Json
          template_id: string
          updated_at?: string
          version: string
        }
        Update: {
          applies_to_node_types?: string[]
          category?: string | null
          created_at?: string
          created_by?: string | null
          deliverable_type?: string
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          node_subtypes?: string[] | null
          organisation_id?: string | null
          sans_reference?: string | null
          schema_json?: Json
          template_id?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      allocate_coc_number: { Args: { _inspection_id: string }; Returns: string }
      is_inspection_verifier: {
        Args: { _inspection_id: string }
        Returns: boolean
      }
      user_can_verify: { Args: { _project_id: string }; Returns: boolean }
      user_can_write_responses: {
        Args: { _inspection_id: string }
        Returns: boolean
      }
      user_has_inspection_read: {
        Args: { _inspection_id: string }
        Returns: boolean
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  marketplace: {
    Tables: {
      catalogue_items: {
        Row: {
          category: string
          created_at: string
          currency: string
          description: string | null
          id: string
          is_active: boolean
          lead_time_days: number | null
          marketplace_visible: boolean
          metadata: Json
          min_order_qty: number
          name: string
          sku: string | null
          supplier_id: string
          supplier_org_id: string | null
          unit: string
          unit_price: number
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number | null
          marketplace_visible?: boolean
          metadata?: Json
          min_order_qty?: number
          name: string
          sku?: string | null
          supplier_id: string
          supplier_org_id?: string | null
          unit?: string
          unit_price: number
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          is_active?: boolean
          lead_time_days?: number | null
          marketplace_visible?: boolean
          metadata?: Json
          min_order_qty?: number
          name?: string
          sku?: string | null
          supplier_id?: string
          supplier_org_id?: string | null
          unit?: string
          unit_price?: number
          updated_at?: string
        }
        Relationships: []
      }
      commission_payouts: {
        Row: {
          amount_kobo: number
          commission_record_ids: string[]
          completed_at: string | null
          created_at: string
          failure_reason: string | null
          id: string
          initiated_at: string
          paystack_recipient_code: string | null
          paystack_transfer_code: string | null
          status: string
          supplier_id: string
          supplier_subaccount_code: string
          updated_at: string
        }
        Insert: {
          amount_kobo: number
          commission_record_ids?: string[]
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          initiated_at?: string
          paystack_recipient_code?: string | null
          paystack_transfer_code?: string | null
          status?: string
          supplier_id: string
          supplier_subaccount_code: string
          updated_at?: string
        }
        Update: {
          amount_kobo?: number
          commission_record_ids?: string[]
          completed_at?: string | null
          created_at?: string
          failure_reason?: string | null
          id?: string
          initiated_at?: string
          paystack_recipient_code?: string | null
          paystack_transfer_code?: string | null
          status?: string
          supplier_id?: string
          supplier_subaccount_code?: string
          updated_at?: string
        }
        Relationships: []
      }
      commission_records: {
        Row: {
          commission_kobo: number
          commission_rate: number
          contractor_org_id: string
          created_at: string
          gross_amount_kobo: number
          id: string
          order_id: string
          payout_completed_at: string | null
          payout_failed_at: string | null
          payout_failure_reason: string | null
          payout_initiated_at: string | null
          payout_reference: string | null
          payout_status: string
          paystack_reference: string
          paystack_split_code: string | null
          supplier_kobo: number
          supplier_org_id: string | null
          supplier_subaccount_code: string | null
          updated_at: string
        }
        Insert: {
          commission_kobo: number
          commission_rate: number
          contractor_org_id: string
          created_at?: string
          gross_amount_kobo: number
          id?: string
          order_id: string
          payout_completed_at?: string | null
          payout_failed_at?: string | null
          payout_failure_reason?: string | null
          payout_initiated_at?: string | null
          payout_reference?: string | null
          payout_status?: string
          paystack_reference: string
          paystack_split_code?: string | null
          supplier_kobo: number
          supplier_org_id?: string | null
          supplier_subaccount_code?: string | null
          updated_at?: string
        }
        Update: {
          commission_kobo?: number
          commission_rate?: number
          contractor_org_id?: string
          created_at?: string
          gross_amount_kobo?: number
          id?: string
          order_id?: string
          payout_completed_at?: string | null
          payout_failed_at?: string | null
          payout_failure_reason?: string | null
          payout_initiated_at?: string | null
          payout_reference?: string | null
          payout_status?: string
          paystack_reference?: string
          paystack_split_code?: string | null
          supplier_kobo?: number
          supplier_org_id?: string | null
          supplier_subaccount_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "commission_records_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          catalogue_item_id: string | null
          created_at: string
          description: string
          id: string
          line_total: number | null
          order_id: string
          quantity: number
          unit: string
          unit_price: number
        }
        Insert: {
          catalogue_item_id?: string | null
          created_at?: string
          description: string
          id?: string
          line_total?: number | null
          order_id: string
          quantity: number
          unit?: string
          unit_price: number
        }
        Update: {
          catalogue_item_id?: string | null
          created_at?: string
          description?: string
          id?: string
          line_total?: number | null
          order_id?: string
          quantity?: number
          unit?: string
          unit_price?: number
        }
        Relationships: [
          {
            foreignKeyName: "order_items_catalogue_item_id_fkey"
            columns: ["catalogue_item_id"]
            isOneToOne: false
            referencedRelation: "catalogue_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          commission_amount: number | null
          commission_rate: number | null
          contractor_org_id: string
          created_at: string
          created_by: string
          currency: string
          id: string
          notes: string | null
          paid_at: string | null
          payment_status: string
          paystack_reference: string | null
          paystack_split_code: string | null
          project_id: string | null
          status: string
          supplier_id: string
          supplier_org_id: string | null
          total_amount: number | null
          updated_at: string
        }
        Insert: {
          commission_amount?: number | null
          commission_rate?: number | null
          contractor_org_id: string
          created_at?: string
          created_by: string
          currency?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_status?: string
          paystack_reference?: string | null
          paystack_split_code?: string | null
          project_id?: string | null
          status?: string
          supplier_id: string
          supplier_org_id?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Update: {
          commission_amount?: number | null
          commission_rate?: number | null
          contractor_org_id?: string
          created_at?: string
          created_by?: string
          currency?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_status?: string
          paystack_reference?: string | null
          paystack_split_code?: string | null
          project_id?: string | null
          status?: string
          supplier_id?: string
          supplier_org_id?: string | null
          total_amount?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      paystack_subaccounts: {
        Row: {
          account_number: string
          business_name: string
          created_at: string
          id: string
          is_verified: boolean
          metadata: Json
          paystack_id: number | null
          percentage_charge: number
          settlement_bank: string
          split_code: string | null
          subaccount_code: string
          supplier_id: string
          supplier_org_id: string | null
          updated_at: string
        }
        Insert: {
          account_number: string
          business_name: string
          created_at?: string
          id?: string
          is_verified?: boolean
          metadata?: Json
          paystack_id?: number | null
          percentage_charge?: number
          settlement_bank: string
          split_code?: string | null
          subaccount_code: string
          supplier_id: string
          supplier_org_id?: string | null
          updated_at?: string
        }
        Update: {
          account_number?: string
          business_name?: string
          created_at?: string
          id?: string
          is_verified?: boolean
          metadata?: Json
          paystack_id?: number | null
          percentage_charge?: number
          settlement_bank?: string
          split_code?: string | null
          subaccount_code?: string
          supplier_id?: string
          supplier_org_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      supplier_ratings: {
        Row: {
          comment: string | null
          communication_score: number
          contractor_org_id: string
          created_at: string
          delivery_score: number
          id: string
          order_id: string
          pricing_score: number
          quality_score: number
          rated_by: string
          supplier_id: string
        }
        Insert: {
          comment?: string | null
          communication_score: number
          contractor_org_id: string
          created_at?: string
          delivery_score: number
          id?: string
          order_id: string
          pricing_score: number
          quality_score: number
          rated_by: string
          supplier_id: string
        }
        Update: {
          comment?: string | null
          communication_score?: number
          contractor_org_id?: string
          created_at?: string
          delivery_score?: number
          id?: string
          order_id?: string
          pricing_score?: number
          quality_score?: number
          rated_by?: string
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_ratings_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      supplier_rating_summary: {
        Row: {
          avg_communication: number | null
          avg_delivery: number | null
          avg_overall: number | null
          avg_pricing: number | null
          avg_quality: number | null
          rating_count: number | null
          supplier_id: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      order_protected_columns_unchanged: {
        Args: { p_new: Json }
        Returns: boolean
      }
      refresh_supplier_rating_summary: { Args: never; Returns: undefined }
      set_order_quote: {
        Args: { p_order_id: string; p_total_amount: number }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  projects: {
    Tables: {
      boq_imports: {
        Row: {
          created_at: string
          id: string
          imported_at: string
          imported_by: string | null
          is_current: boolean
          line_item_count: number
          organisation_id: string
          project_id: string
          source_filename: string
          storage_path: string | null
          total_ex_vat: number | null
          total_incl_vat: number | null
          updated_at: string
          vat_amount: number | null
        }
        Insert: {
          created_at?: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          is_current?: boolean
          line_item_count?: number
          organisation_id: string
          project_id: string
          source_filename: string
          storage_path?: string | null
          total_ex_vat?: number | null
          total_incl_vat?: number | null
          updated_at?: string
          vat_amount?: number | null
        }
        Update: {
          created_at?: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          is_current?: boolean
          line_item_count?: number
          organisation_id?: string
          project_id?: string
          source_filename?: string
          storage_path?: string | null
          total_ex_vat?: number | null
          total_incl_vat?: number | null
          updated_at?: string
          vat_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_imports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_items: {
        Row: {
          amount: number | null
          code: string | null
          created_at: string
          description: string
          id: string
          install_rate: number | null
          origin: string
          quantity: number | null
          quantity_mode: string
          rate: number | null
          rate_model: string
          section_id: string
          sort_order: number
          supply_rate: number | null
          unit: string | null
          updated_at: string
          variation_line_id: string | null
        }
        Insert: {
          amount?: number | null
          code?: string | null
          created_at?: string
          description: string
          id?: string
          install_rate?: number | null
          origin?: string
          quantity?: number | null
          quantity_mode?: string
          rate?: number | null
          rate_model?: string
          section_id: string
          sort_order?: number
          supply_rate?: number | null
          unit?: string | null
          updated_at?: string
          variation_line_id?: string | null
        }
        Update: {
          amount?: number | null
          code?: string | null
          created_at?: string
          description?: string
          id?: string
          install_rate?: number | null
          origin?: string
          quantity?: number | null
          quantity_mode?: string
          rate?: number | null
          rate_model?: string
          section_id?: string
          sort_order?: number
          supply_rate?: number | null
          unit?: string | null
          updated_at?: string
          variation_line_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "boq_items_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "boq_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_items_variation_line_id_fkey"
            columns: ["variation_line_id"]
            isOneToOne: false
            referencedRelation: "variation_lines"
            referencedColumns: ["id"]
          },
        ]
      }
      boq_sections: {
        Row: {
          code: string | null
          created_at: string
          id: string
          import_id: string
          kind: string
          node_id: string | null
          parent_section_id: string | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          code?: string | null
          created_at?: string
          id?: string
          import_id: string
          kind: string
          node_id?: string | null
          parent_section_id?: string | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          code?: string | null
          created_at?: string
          id?: string
          import_id?: string
          kind?: string
          node_id?: string | null
          parent_section_id?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boq_sections_import_id_fkey"
            columns: ["import_id"]
            isOneToOne: false
            referencedRelation: "boq_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boq_sections_parent_fk"
            columns: ["import_id", "parent_section_id"]
            isOneToOne: false
            referencedRelation: "boq_sections"
            referencedColumns: ["import_id", "id"]
          },
        ]
      }
      calendar_years: {
        Row: {
          seeded_at: string
          year: number
        }
        Insert: {
          seeded_at?: string
          year: number
        }
        Update: {
          seeded_at?: string
          year?: number
        }
        Relationships: []
      }
      contacts: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          organisation_id: string
          phone: string | null
          project_id: string
          role: string | null
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          organisation_id: string
          phone?: string | null
          project_id: string
          role?: string | null
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          organisation_id?: string
          phone?: string | null
          project_id?: string
          role?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "contacts_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      drawings: {
        Row: {
          created_at: string
          discipline: string | null
          file_path: string
          file_size_bytes: number | null
          id: string
          organisation_id: string
          project_id: string
          revision: string | null
          status: string
          title: string
          updated_at: string
          uploaded_by: string
        }
        Insert: {
          created_at?: string
          discipline?: string | null
          file_path: string
          file_size_bytes?: number | null
          id?: string
          organisation_id: string
          project_id: string
          revision?: string | null
          status?: string
          title: string
          updated_at?: string
          uploaded_by: string
        }
        Update: {
          created_at?: string
          discipline?: string | null
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          organisation_id?: string
          project_id?: string
          revision?: string | null
          status?: string
          title?: string
          updated_at?: string
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "drawings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      handover_checklist: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          id: string
          is_complete: boolean
          item: string
          organisation_id: string
          project_id: string
          sort_order: number
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          is_complete?: boolean
          item: string
          organisation_id: string
          project_id: string
          sort_order?: number
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          id?: string
          is_complete?: boolean
          item?: string
          organisation_id?: string
          project_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "handover_checklist_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      jbcc_clauses: {
        Row: {
          clause_ref: string
          consequence_of_failure: string | null
          contract: string
          description: string
          edition: string
          id: string
          linked_notice: string | null
          practical_use: string | null
          sort_order: number
          time_bar: string | null
          topic: string
          triggering_event: string | null
        }
        Insert: {
          clause_ref: string
          consequence_of_failure?: string | null
          contract: string
          description: string
          edition: string
          id?: string
          linked_notice?: string | null
          practical_use?: string | null
          sort_order: number
          time_bar?: string | null
          topic: string
          triggering_event?: string | null
        }
        Update: {
          clause_ref?: string
          consequence_of_failure?: string | null
          contract?: string
          description?: string
          edition?: string
          id?: string
          linked_notice?: string | null
          practical_use?: string | null
          sort_order?: number
          time_bar?: string | null
          topic?: string
          triggering_event?: string | null
        }
        Relationships: []
      }
      jbcc_letter_attachments: {
        Row: {
          created_at: string
          created_by: string
          file_name: string
          file_path: string
          id: string
          letter_id: string
          mime_type: string | null
          organisation_id: string
          size_bytes: number | null
        }
        Insert: {
          created_at?: string
          created_by: string
          file_name: string
          file_path: string
          id?: string
          letter_id: string
          mime_type?: string | null
          organisation_id: string
          size_bytes?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string
          file_name?: string
          file_path?: string
          id?: string
          letter_id?: string
          mime_type?: string | null
          organisation_id?: string
          size_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "jbcc_letter_attachments_letter_id_fkey"
            columns: ["letter_id"]
            isOneToOne: false
            referencedRelation: "jbcc_letters"
            referencedColumns: ["id"]
          },
        ]
      }
      jbcc_letter_events: {
        Row: {
          actor_id: string
          event_type: string
          from_status: string | null
          id: string
          letter_id: string
          metadata: Json
          occurred_at: string
          organisation_id: string
          to_status: string | null
        }
        Insert: {
          actor_id: string
          event_type: string
          from_status?: string | null
          id?: string
          letter_id: string
          metadata?: Json
          occurred_at?: string
          organisation_id: string
          to_status?: string | null
        }
        Update: {
          actor_id?: string
          event_type?: string
          from_status?: string | null
          id?: string
          letter_id?: string
          metadata?: Json
          occurred_at?: string
          organisation_id?: string
          to_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "jbcc_letter_events_letter_id_fkey"
            columns: ["letter_id"]
            isOneToOne: false
            referencedRelation: "jbcc_letters"
            referencedColumns: ["id"]
          },
        ]
      }
      jbcc_letter_number_seqs: {
        Row: {
          last_seq: number
          project_id: string
          year: number
        }
        Insert: {
          last_seq?: number
          project_id: string
          year: number
        }
        Update: {
          last_seq?: number
          project_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "jbcc_letter_number_seqs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      jbcc_letter_recipients: {
        Row: {
          created_at: string
          disposition: string
          id: string
          letter_id: string
          organisation_id: string
          party_id: string | null
          party_name_snapshot: string
        }
        Insert: {
          created_at?: string
          disposition?: string
          id?: string
          letter_id: string
          organisation_id: string
          party_id?: string | null
          party_name_snapshot: string
        }
        Update: {
          created_at?: string
          disposition?: string
          id?: string
          letter_id?: string
          organisation_id?: string
          party_id?: string | null
          party_name_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "jbcc_letter_recipients_letter_id_fkey"
            columns: ["letter_id"]
            isOneToOne: false
            referencedRelation: "jbcc_letters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jbcc_letter_recipients_party_id_fkey"
            columns: ["party_id"]
            isOneToOne: false
            referencedRelation: "jbcc_parties"
            referencedColumns: ["id"]
          },
        ]
      }
      jbcc_letters: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string
          deadline_date: string | null
          deemed_service_date: string | null
          deleted_at: string | null
          document_path: string
          field_values: Json
          id: string
          issued_at: string | null
          issued_by: string | null
          issued_date: string | null
          legal_hold: boolean
          letter_reference: string | null
          notes: string | null
          notice_id: string
          organisation_id: string
          project_id: string
          proof_attachment_id: string | null
          recipient_party_id: string | null
          retention_until: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          revision: number
          served_at: string | null
          served_by: string | null
          served_date: string | null
          service_method: string | null
          service_reference: string | null
          status: string
          subject: string | null
          superseded_by_letter_id: string | null
          supersedes_letter_id: string | null
          trigger_date: string | null
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by: string
          deadline_date?: string | null
          deemed_service_date?: string | null
          deleted_at?: string | null
          document_path: string
          field_values?: Json
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          issued_date?: string | null
          legal_hold?: boolean
          letter_reference?: string | null
          notes?: string | null
          notice_id: string
          organisation_id: string
          project_id: string
          proof_attachment_id?: string | null
          recipient_party_id?: string | null
          retention_until?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          served_at?: string | null
          served_by?: string | null
          served_date?: string | null
          service_method?: string | null
          service_reference?: string | null
          status?: string
          subject?: string | null
          superseded_by_letter_id?: string | null
          supersedes_letter_id?: string | null
          trigger_date?: string | null
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string
          deadline_date?: string | null
          deemed_service_date?: string | null
          deleted_at?: string | null
          document_path?: string
          field_values?: Json
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          issued_date?: string | null
          legal_hold?: boolean
          letter_reference?: string | null
          notes?: string | null
          notice_id?: string
          organisation_id?: string
          project_id?: string
          proof_attachment_id?: string | null
          recipient_party_id?: string | null
          retention_until?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          revision?: number
          served_at?: string | null
          served_by?: string | null
          served_date?: string | null
          service_method?: string | null
          service_reference?: string | null
          status?: string
          subject?: string | null
          superseded_by_letter_id?: string | null
          supersedes_letter_id?: string | null
          trigger_date?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jbcc_letters_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "jbcc_notices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jbcc_letters_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jbcc_letters_proof_attachment_fk"
            columns: ["proof_attachment_id"]
            isOneToOne: false
            referencedRelation: "jbcc_letter_attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jbcc_letters_recipient_party_id_fkey"
            columns: ["recipient_party_id"]
            isOneToOne: false
            referencedRelation: "jbcc_parties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jbcc_letters_superseded_by_letter_id_fkey"
            columns: ["superseded_by_letter_id"]
            isOneToOne: false
            referencedRelation: "jbcc_letters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "jbcc_letters_supersedes_letter_id_fkey"
            columns: ["supersedes_letter_id"]
            isOneToOne: false
            referencedRelation: "jbcc_letters"
            referencedColumns: ["id"]
          },
        ]
      }
      jbcc_notice_fields: {
        Row: {
          field_type: string
          id: string
          label: string
          notice_id: string
          placeholder: string
          required: boolean
          sort_order: number
          source: string
        }
        Insert: {
          field_type: string
          id?: string
          label: string
          notice_id: string
          placeholder: string
          required?: boolean
          sort_order: number
          source: string
        }
        Update: {
          field_type?: string
          id?: string
          label?: string
          notice_id?: string
          placeholder?: string
          required?: boolean
          sort_order?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "jbcc_notice_fields_notice_id_fkey"
            columns: ["notice_id"]
            isOneToOne: false
            referencedRelation: "jbcc_notices"
            referencedColumns: ["id"]
          },
        ]
      }
      jbcc_notices: {
        Row: {
          category: string
          code: string
          consequence_of_failure: string
          contract: string
          edition: string
          from_party: string
          id: string
          purpose: string
          sort_order: number
          template_file: string
          time_bar_basis: string | null
          time_bar_days: number | null
          time_bar_text: string
          time_bar_unit: string | null
          title: string
          to_party: string
          triggering_clause: string
        }
        Insert: {
          category: string
          code: string
          consequence_of_failure: string
          contract: string
          edition: string
          from_party: string
          id?: string
          purpose: string
          sort_order: number
          template_file: string
          time_bar_basis?: string | null
          time_bar_days?: number | null
          time_bar_text: string
          time_bar_unit?: string | null
          title: string
          to_party: string
          triggering_clause: string
        }
        Update: {
          category?: string
          code?: string
          consequence_of_failure?: string
          contract?: string
          edition?: string
          from_party?: string
          id?: string
          purpose?: string
          sort_order?: number
          template_file?: string
          time_bar_basis?: string | null
          time_bar_days?: number | null
          time_bar_text?: string
          time_bar_unit?: string | null
          title?: string
          to_party?: string
          triggering_clause?: string
        }
        Relationships: []
      }
      jbcc_parties: {
        Row: {
          address: string | null
          company: string | null
          created_at: string
          created_by: string
          email: string | null
          id: string
          name: string
          organisation_id: string
          party_role: string
          phone: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          company?: string | null
          created_at?: string
          created_by: string
          email?: string | null
          id?: string
          name: string
          organisation_id: string
          party_role: string
          phone?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          company?: string | null
          created_at?: string
          created_by?: string
          email?: string | null
          id?: string
          name?: string
          organisation_id?: string
          party_role?: string
          phone?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "jbcc_parties_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      jbcc_time_bar_schedule: {
        Row: {
          action: string
          clause: string
          id: string
          parties: string
          sort_order: number
          time_period: string
        }
        Insert: {
          action: string
          clause: string
          id?: string
          parties: string
          sort_order: number
          time_period: string
        }
        Update: {
          action?: string
          clause?: string
          id?: string
          parties?: string
          sort_order?: number
          time_period?: string
        }
        Relationships: []
      }
      project_members: {
        Row: {
          added_by: string | null
          created_at: string
          id: string
          is_active: boolean
          organisation_id: string
          project_id: string
          role: string
          user_id: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          organisation_id: string
          project_id: string
          role?: string
          user_id: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          organisation_id?: string
          project_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_members_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_settings: {
        Row: {
          builders_holiday: boolean
          builders_shutdown_end_md: string
          builders_shutdown_start_md: string
          contract_signed_date: string | null
          contract_type: string
          created_at: string
          date_format: string
          default_inspection_template_id: string | null
          default_rfi_assignee_id: string | null
          default_rfi_due_days: number
          default_rfi_priority: string
          extra_holidays: string[]
          holiday_calendar: string
          id: string
          notify_diary_email: boolean
          notify_form_email: boolean
          notify_inspection_email: boolean
          notify_qc_email: boolean
          notify_rfi_email: boolean
          notify_snag_email: boolean
          notify_solar_email: boolean
          organisation_id: string
          practical_completion_date: string | null
          project_id: string
          retention_pct: number
          triage_owner_id: string | null
          units: string
          updated_at: string
          updated_by: string | null
          work_item_defaults: Json
          working_days: number[]
        }
        Insert: {
          builders_holiday?: boolean
          builders_shutdown_end_md?: string
          builders_shutdown_start_md?: string
          contract_signed_date?: string | null
          contract_type?: string
          created_at?: string
          date_format?: string
          default_inspection_template_id?: string | null
          default_rfi_assignee_id?: string | null
          default_rfi_due_days?: number
          default_rfi_priority?: string
          extra_holidays?: string[]
          holiday_calendar?: string
          id?: string
          notify_diary_email?: boolean
          notify_form_email?: boolean
          notify_inspection_email?: boolean
          notify_qc_email?: boolean
          notify_rfi_email?: boolean
          notify_snag_email?: boolean
          notify_solar_email?: boolean
          organisation_id: string
          practical_completion_date?: string | null
          project_id: string
          retention_pct?: number
          triage_owner_id?: string | null
          units?: string
          updated_at?: string
          updated_by?: string | null
          work_item_defaults?: Json
          working_days?: number[]
        }
        Update: {
          builders_holiday?: boolean
          builders_shutdown_end_md?: string
          builders_shutdown_start_md?: string
          contract_signed_date?: string | null
          contract_type?: string
          created_at?: string
          date_format?: string
          default_inspection_template_id?: string | null
          default_rfi_assignee_id?: string | null
          default_rfi_due_days?: number
          default_rfi_priority?: string
          extra_holidays?: string[]
          holiday_calendar?: string
          id?: string
          notify_diary_email?: boolean
          notify_form_email?: boolean
          notify_inspection_email?: boolean
          notify_qc_email?: boolean
          notify_rfi_email?: boolean
          notify_snag_email?: boolean
          notify_solar_email?: boolean
          organisation_id?: string
          practical_completion_date?: string | null
          project_id?: string
          retention_pct?: number
          triage_owner_id?: string | null
          units?: string
          updated_at?: string
          updated_by?: string | null
          work_item_defaults?: Json
          working_days?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "project_settings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: true
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_settings_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          diff: Json | null
          id: string
          operation: string
          organisation_id: string
          project_id: string
          snapshot: Json
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          diff?: Json | null
          id?: string
          operation: string
          organisation_id: string
          project_id: string
          snapshot: Json
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          diff?: Json | null
          id?: string
          operation?: string
          organisation_id?: string
          project_id?: string
          snapshot?: Json
        }
        Relationships: [
          {
            foreignKeyName: "project_settings_history_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          address: string | null
          city: string | null
          client_contact: string | null
          client_logo_url: string | null
          client_name: string | null
          cloud_storage_connection_id: string | null
          cloud_storage_default_target: string | null
          cloud_storage_folder_id: string | null
          cloud_storage_folder_path: string | null
          cloud_storage_last_sync_at: string | null
          code: string
          contract_value: number | null
          created_at: string
          created_by: string
          currency: string
          description: string | null
          end_date: string | null
          handover_cloud_folder_id: string | null
          handover_cloud_folder_path: string | null
          id: string
          name: string
          opening_date: string | null
          organisation_id: string
          project_logo_url: string | null
          project_type: string | null
          province: string | null
          report_accent_color: string | null
          site_manager_id: string | null
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          city?: string | null
          client_contact?: string | null
          client_logo_url?: string | null
          client_name?: string | null
          cloud_storage_connection_id?: string | null
          cloud_storage_default_target?: string | null
          cloud_storage_folder_id?: string | null
          cloud_storage_folder_path?: string | null
          cloud_storage_last_sync_at?: string | null
          // Auto-filled by the projects_ensure_code BEFORE INSERT trigger
          // (migration 00095); supabase gen types cannot see triggers.
          code?: string
          contract_value?: number | null
          created_at?: string
          created_by: string
          currency?: string
          description?: string | null
          end_date?: string | null
          handover_cloud_folder_id?: string | null
          handover_cloud_folder_path?: string | null
          id?: string
          name: string
          opening_date?: string | null
          organisation_id: string
          project_logo_url?: string | null
          project_type?: string | null
          province?: string | null
          report_accent_color?: string | null
          site_manager_id?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          city?: string | null
          client_contact?: string | null
          client_logo_url?: string | null
          client_name?: string | null
          cloud_storage_connection_id?: string | null
          cloud_storage_default_target?: string | null
          cloud_storage_folder_id?: string | null
          cloud_storage_folder_path?: string | null
          cloud_storage_last_sync_at?: string | null
          code?: string
          contract_value?: number | null
          created_at?: string
          created_by?: string
          currency?: string
          description?: string | null
          end_date?: string | null
          handover_cloud_folder_id?: string | null
          handover_cloud_folder_path?: string | null
          id?: string
          name?: string
          opening_date?: string | null
          organisation_id?: string
          project_logo_url?: string | null
          project_type?: string | null
          province?: string | null
          report_accent_color?: string | null
          site_manager_id?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      public_holidays: {
        Row: {
          d: string
          name: string
        }
        Insert: {
          d: string
          name: string
        }
        Update: {
          d?: string
          name?: string
        }
        Relationships: []
      }
      qc_comments: {
        Row: {
          body: string
          created_at: string
          created_by: string
          entry_id: string
          id: string
          photo_id: string | null
          report_id: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by: string
          entry_id: string
          id?: string
          photo_id?: string | null
          report_id: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string
          entry_id?: string
          id?: string
          photo_id?: string | null
          report_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qc_comments_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qc_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qc_comments_photo_id_fkey"
            columns: ["photo_id"]
            isOneToOne: false
            referencedRelation: "qc_entry_photos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qc_comments_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "qc_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      qc_entries: {
        Row: {
          conformance: string
          created_at: string
          created_by: string
          description: string | null
          id: string
          organisation_id: string
          project_id: string
          report_id: string
          severity: string | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          conformance?: string
          created_at?: string
          created_by: string
          description?: string | null
          id?: string
          organisation_id: string
          project_id: string
          report_id: string
          severity?: string | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          conformance?: string
          created_at?: string
          created_by?: string
          description?: string | null
          id?: string
          organisation_id?: string
          project_id?: string
          report_id?: string
          severity?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qc_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qc_entries_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "qc_reports"
            referencedColumns: ["id"]
          },
        ]
      }
      qc_entry_photos: {
        Row: {
          annotation_data: Json | null
          caption: string | null
          created_at: string
          entry_id: string
          file_name: string | null
          file_path: string
          file_size_bytes: number | null
          id: string
          kind: string
          mime_type: string | null
          organisation_id: string
          project_id: string
          sort_order: number
          source_floor_plan_id: string | null
          uploaded_by: string
        }
        Insert: {
          annotation_data?: Json | null
          caption?: string | null
          created_at?: string
          entry_id: string
          file_name?: string | null
          file_path: string
          file_size_bytes?: number | null
          id?: string
          kind?: string
          mime_type?: string | null
          organisation_id: string
          project_id: string
          sort_order?: number
          source_floor_plan_id?: string | null
          uploaded_by: string
        }
        Update: {
          annotation_data?: Json | null
          caption?: string | null
          created_at?: string
          entry_id?: string
          file_name?: string | null
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          kind?: string
          mime_type?: string | null
          organisation_id?: string
          project_id?: string
          sort_order?: number
          source_floor_plan_id?: string | null
          uploaded_by?: string
        }
        Relationships: [
          {
            foreignKeyName: "qc_entry_photos_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "qc_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qc_entry_photos_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      qc_reports: {
        Row: {
          created_at: string
          description: string | null
          id: string
          inspection_date: string | null
          issued_at: string | null
          issued_by: string | null
          location: string | null
          organisation_id: string
          project_id: string
          raised_by: string
          report_no: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          inspection_date?: string | null
          issued_at?: string | null
          issued_by?: string | null
          location?: string | null
          organisation_id: string
          project_id: string
          raised_by: string
          report_no?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          inspection_date?: string | null
          issued_at?: string | null
          issued_by?: string | null
          location?: string | null
          organisation_id?: string
          project_id?: string
          raised_by?: string
          report_no?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qc_reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      reports: {
        Row: {
          branding_snapshot: Json | null
          created_at: string
          generated_at: string
          generated_by: string | null
          id: string
          kind: string
          mime_type: string
          note: string | null
          organisation_id: string
          project_id: string
          size_bytes: number | null
          source_id: string | null
          source_table: string | null
          status: string
          storage_path: string
          summary: Json | null
          superseded_by: string | null
          title: string
          updated_at: string
          version: number
        }
        Insert: {
          branding_snapshot?: Json | null
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          kind: string
          mime_type?: string
          note?: string | null
          organisation_id: string
          project_id: string
          size_bytes?: number | null
          source_id?: string | null
          source_table?: string | null
          status?: string
          storage_path: string
          summary?: Json | null
          superseded_by?: string | null
          title: string
          updated_at?: string
          version?: number
        }
        Update: {
          branding_snapshot?: Json | null
          created_at?: string
          generated_at?: string
          generated_by?: string | null
          id?: string
          kind?: string
          mime_type?: string
          note?: string | null
          organisation_id?: string
          project_id?: string
          size_bytes?: number | null
          source_id?: string | null
          source_table?: string | null
          status?: string
          storage_path?: string
          summary?: Json | null
          superseded_by?: string | null
          title?: string
          updated_at?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "reports_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_superseded_by_fkey"
            columns: ["superseded_by"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      rfi_responses: {
        Row: {
          body: string
          created_at: string
          id: string
          responded_by: string
          rfi_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          responded_by: string
          rfi_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          responded_by?: string
          rfi_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfi_responses_rfi_id_fkey"
            columns: ["rfi_id"]
            isOneToOne: false
            referencedRelation: "rfis"
            referencedColumns: ["id"]
          },
        ]
      }
      rfis: {
        Row: {
          assigned_to: string | null
          category: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          description: string
          due_date: string | null
          id: string
          organisation_id: string
          priority: string
          project_id: string
          raised_by: string
          rfi_number: number
          status: string
          subject: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          category?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          description: string
          due_date?: string | null
          id?: string
          organisation_id: string
          priority?: string
          project_id: string
          raised_by: string
          rfi_number?: never
          status?: string
          subject: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          category?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          description?: string
          due_date?: string | null
          id?: string
          organisation_id?: string
          priority?: string
          project_id?: string
          raised_by?: string
          rfi_number?: never
          status?: string
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfis_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      site_diary_attachments: {
        Row: {
          caption: string | null
          created_at: string
          diary_entry_id: string
          file_name: string
          file_path: string
          file_size_bytes: number
          id: string
          kind: string
          mime_type: string
          sort_order: number
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          diary_entry_id: string
          file_name: string
          file_path: string
          file_size_bytes: number
          id?: string
          kind: string
          mime_type: string
          sort_order?: number
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          diary_entry_id?: string
          file_name?: string
          file_path?: string
          file_size_bytes?: number
          id?: string
          kind?: string
          mime_type?: string
          sort_order?: number
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "site_diary_attachments_diary_entry_id_fkey"
            columns: ["diary_entry_id"]
            isOneToOne: false
            referencedRelation: "site_diary_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      site_diary_entries: {
        Row: {
          created_at: string
          created_by: string
          delay_notes: string | null
          delays: string | null
          entry_date: string
          entry_type: Database["public"]["Enums"]["diary_entry_type"]
          id: string
          organisation_id: string
          progress_notes: string
          project_id: string
          quality_notes: string | null
          safety_notes: string | null
          updated_at: string
          weather: string | null
          workers_on_site: number | null
        }
        Insert: {
          created_at?: string
          created_by: string
          delay_notes?: string | null
          delays?: string | null
          entry_date: string
          entry_type?: Database["public"]["Enums"]["diary_entry_type"]
          id?: string
          organisation_id: string
          progress_notes: string
          project_id: string
          quality_notes?: string | null
          safety_notes?: string | null
          updated_at?: string
          weather?: string | null
          workers_on_site?: number | null
        }
        Update: {
          created_at?: string
          created_by?: string
          delay_notes?: string | null
          delays?: string | null
          entry_date?: string
          entry_type?: Database["public"]["Enums"]["diary_entry_type"]
          id?: string
          organisation_id?: string
          progress_notes?: string
          project_id?: string
          quality_notes?: string | null
          safety_notes?: string | null
          updated_at?: string
          weather?: string | null
          workers_on_site?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "site_diary_entries_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      valuation_lines: {
        Row: {
          boq_item_id: string
          created_at: string
          id: string
          input_method: string
          percent_complete: number | null
          qty_complete: number | null
          updated_at: string
          valuation_id: string
          value_to_date: number
        }
        Insert: {
          boq_item_id: string
          created_at?: string
          id?: string
          input_method: string
          percent_complete?: number | null
          qty_complete?: number | null
          updated_at?: string
          valuation_id: string
          value_to_date: number
        }
        Update: {
          boq_item_id?: string
          created_at?: string
          id?: string
          input_method?: string
          percent_complete?: number | null
          qty_complete?: number | null
          updated_at?: string
          valuation_id?: string
          value_to_date?: number
        }
        Relationships: [
          {
            foreignKeyName: "valuation_lines_boq_item_id_fkey"
            columns: ["boq_item_id"]
            isOneToOne: false
            referencedRelation: "boq_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valuation_lines_valuation_id_fkey"
            columns: ["valuation_id"]
            isOneToOne: false
            referencedRelation: "valuations"
            referencedColumns: ["id"]
          },
        ]
      }
      valuations: {
        Row: {
          boq_import_id: string
          certified_at: string | null
          certified_by: string | null
          created_at: string
          created_by: string | null
          due_ex_vat: number | null
          due_incl_vat: number | null
          gross_to_date: number | null
          id: string
          net_to_date: number | null
          notes: string | null
          organisation_id: string
          previous_net: number | null
          project_id: string
          report_id: string | null
          retention_amount: number | null
          retention_pct: number
          status: string
          updated_at: string
          valuation_date: string
          valuation_no: number
          vat_amount: number | null
        }
        Insert: {
          boq_import_id: string
          certified_at?: string | null
          certified_by?: string | null
          created_at?: string
          created_by?: string | null
          due_ex_vat?: number | null
          due_incl_vat?: number | null
          gross_to_date?: number | null
          id?: string
          net_to_date?: number | null
          notes?: string | null
          organisation_id: string
          previous_net?: number | null
          project_id: string
          report_id?: string | null
          retention_amount?: number | null
          retention_pct: number
          status?: string
          updated_at?: string
          valuation_date: string
          valuation_no?: number
          vat_amount?: number | null
        }
        Update: {
          boq_import_id?: string
          certified_at?: string | null
          certified_by?: string | null
          created_at?: string
          created_by?: string | null
          due_ex_vat?: number | null
          due_incl_vat?: number | null
          gross_to_date?: number | null
          id?: string
          net_to_date?: number | null
          notes?: string | null
          organisation_id?: string
          previous_net?: number | null
          project_id?: string
          report_id?: string | null
          retention_amount?: number | null
          retention_pct?: number
          status?: string
          updated_at?: string
          valuation_date?: string
          valuation_no?: number
          vat_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "valuations_boq_import_id_fkey"
            columns: ["boq_import_id"]
            isOneToOne: false
            referencedRelation: "boq_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valuations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "valuations_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      variation_lines: {
        Row: {
          boq_item_id: string | null
          code: string | null
          created_at: string
          description: string | null
          id: string
          install_rate: number | null
          kind: string
          materialized_item_id: string | null
          qty_delta: number | null
          quantity: number | null
          rate: number | null
          rate_model: string | null
          section_id: string | null
          supply_rate: number | null
          unit: string | null
          updated_at: string
          value_change: number
          variation_order_id: string
        }
        Insert: {
          boq_item_id?: string | null
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          install_rate?: number | null
          kind: string
          materialized_item_id?: string | null
          qty_delta?: number | null
          quantity?: number | null
          rate?: number | null
          rate_model?: string | null
          section_id?: string | null
          supply_rate?: number | null
          unit?: string | null
          updated_at?: string
          value_change: number
          variation_order_id: string
        }
        Update: {
          boq_item_id?: string | null
          code?: string | null
          created_at?: string
          description?: string | null
          id?: string
          install_rate?: number | null
          kind?: string
          materialized_item_id?: string | null
          qty_delta?: number | null
          quantity?: number | null
          rate?: number | null
          rate_model?: string | null
          section_id?: string | null
          supply_rate?: number | null
          unit?: string | null
          updated_at?: string
          value_change?: number
          variation_order_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "variation_lines_boq_item_id_fkey"
            columns: ["boq_item_id"]
            isOneToOne: false
            referencedRelation: "boq_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variation_lines_materialized_item_id_fkey"
            columns: ["materialized_item_id"]
            isOneToOne: false
            referencedRelation: "boq_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variation_lines_section_id_fkey"
            columns: ["section_id"]
            isOneToOne: false
            referencedRelation: "boq_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variation_lines_variation_order_id_fkey"
            columns: ["variation_order_id"]
            isOneToOne: false
            referencedRelation: "variation_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      variation_orders: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          boq_import_id: string
          created_at: string
          created_by: string | null
          id: string
          net_change: number | null
          organisation_id: string
          project_id: string
          reason: string | null
          status: string
          title: string
          updated_at: string
          vo_date: string
          vo_no: number
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          boq_import_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          net_change?: number | null
          organisation_id: string
          project_id: string
          reason?: string | null
          status?: string
          title: string
          updated_at?: string
          vo_date: string
          vo_no?: number
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          boq_import_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          net_change?: number | null
          organisation_id?: string
          project_id?: string
          reason?: string | null
          status?: string
          title?: string
          updated_at?: string
          vo_date?: string
          vo_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "variation_orders_boq_import_id_fkey"
            columns: ["boq_import_id"]
            isOneToOne: false
            referencedRelation: "boq_imports"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "variation_orders_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_events: {
        Row: {
          actor_id: string | null
          actor_role: string | null
          created_at: string
          from_ball_in_court_id: string | null
          from_due_date: string | null
          from_status: string | null
          from_user_id: string | null
          id: string
          organisation_id: string
          project_id: string
          seq: number
          to_ball_in_court_id: string | null
          to_due_date: string | null
          to_status: string | null
          to_user_id: string | null
          verb: string
          work_item_id: string
        }
        Insert: {
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          from_ball_in_court_id?: string | null
          from_due_date?: string | null
          from_status?: string | null
          from_user_id?: string | null
          id?: string
          organisation_id: string
          project_id: string
          seq?: never
          to_ball_in_court_id?: string | null
          to_due_date?: string | null
          to_status?: string | null
          to_user_id?: string | null
          verb: string
          work_item_id: string
        }
        Update: {
          actor_id?: string | null
          actor_role?: string | null
          created_at?: string
          from_ball_in_court_id?: string | null
          from_due_date?: string | null
          from_status?: string | null
          from_user_id?: string | null
          id?: string
          organisation_id?: string
          project_id?: string
          seq?: never
          to_ball_in_court_id?: string | null
          to_due_date?: string | null
          to_status?: string | null
          to_user_id?: string | null
          verb?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_events_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_item_events_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_item_types: {
        Row: {
          calendar: string
          default_days: number
          gatekeeper_rule: string
          is_active: boolean
          key: string
          label: string
          sort_order: number
          source_column: string | null
          source_table: string | null
          write_roles: string[]
        }
        Insert: {
          calendar: string
          default_days: number
          gatekeeper_rule: string
          is_active?: boolean
          key: string
          label: string
          sort_order?: number
          source_column?: string | null
          source_table?: string | null
          write_roles: string[]
        }
        Update: {
          calendar?: string
          default_days?: number
          gatekeeper_rule?: string
          is_active?: boolean
          key?: string
          label?: string
          sort_order?: number
          source_column?: string | null
          source_table?: string | null
          write_roles?: string[]
        }
        Relationships: []
      }
      work_item_watchers: {
        Row: {
          created_at: string
          reason: string
          user_id: string
          work_item_id: string
        }
        Insert: {
          created_at?: string
          reason: string
          user_id: string
          work_item_id: string
        }
        Update: {
          created_at?: string
          reason?: string
          user_id?: string
          work_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "work_item_watchers_work_item_id_fkey"
            columns: ["work_item_id"]
            isOneToOne: false
            referencedRelation: "work_items"
            referencedColumns: ["id"]
          },
        ]
      }
      work_items: {
        Row: {
          assignee_id: string
          ball_in_court_id: string | null
          closed_at: string | null
          closed_by: string | null
          created_at: string
          created_by: string
          diary_id: string | null
          due_date: string
          gatekeeper_id: string
          id: string
          inspection_id: string | null
          item_type: string
          last_activity_at: string
          node_order_id: string | null
          opened_at: string
          organisation_id: string
          origin: string
          priority: string
          project_id: string
          qc_entry_id: string | null
          ref: string
          rfi_id: string | null
          site_form_id: string | null
          snag_id: string | null
          source_status: string | null
          status: string
          title: string
          void_reason: string | null
        }
        Insert: {
          assignee_id: string
          ball_in_court_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by: string
          diary_id?: string | null
          due_date: string
          gatekeeper_id: string
          id?: string
          inspection_id?: string | null
          item_type: string
          last_activity_at?: string
          node_order_id?: string | null
          opened_at?: string
          organisation_id: string
          origin?: string
          priority?: string
          project_id: string
          qc_entry_id?: string | null
          ref: string
          rfi_id?: string | null
          site_form_id?: string | null
          snag_id?: string | null
          source_status?: string | null
          status?: string
          title: string
          void_reason?: string | null
        }
        Update: {
          assignee_id?: string
          ball_in_court_id?: string | null
          closed_at?: string | null
          closed_by?: string | null
          created_at?: string
          created_by?: string
          diary_id?: string | null
          due_date?: string
          gatekeeper_id?: string
          id?: string
          inspection_id?: string | null
          item_type?: string
          last_activity_at?: string
          node_order_id?: string | null
          opened_at?: string
          organisation_id?: string
          origin?: string
          priority?: string
          project_id?: string
          qc_entry_id?: string | null
          ref?: string
          rfi_id?: string | null
          site_form_id?: string | null
          snag_id?: string | null
          source_status?: string | null
          status?: string
          title?: string
          void_reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "work_items_diary_id_fkey"
            columns: ["diary_id"]
            isOneToOne: false
            referencedRelation: "site_diary_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_item_type_fkey"
            columns: ["item_type"]
            isOneToOne: false
            referencedRelation: "work_item_types"
            referencedColumns: ["key"]
          },
          {
            foreignKeyName: "work_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_qc_entry_id_fkey"
            columns: ["qc_entry_id"]
            isOneToOne: false
            referencedRelation: "qc_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "work_items_rfi_id_fkey"
            columns: ["rfi_id"]
            isOneToOne: false
            referencedRelation: "rfis"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      add_working_days: {
        Args: {
          p_calendar: string
          p_days: number
          p_from: string
          p_project: string
        }
        Returns: string
      }
      jbcc_allocate_letter_reference: {
        Args: { _project_id: string }
        Returns: string
      }
      jbcc_status_can_transition: {
        Args: { _from: string; _to: string }
        Returns: boolean
      }
      org_owner: { Args: { p_organisation_id: string }; Returns: string }
      project_had_activity: {
        Args: { p_project_id: string; p_since: string; p_until: string }
        Returns: boolean
      }
      push_past_builders_shutdown: {
        Args: { p_date: string; p_project: string }
        Returns: string
      }
      resolve_project_pm: { Args: { p_project_id: string }; Returns: string }
      resolve_triage_owner: { Args: { p_project_id: string }; Returns: string }
      resolve_work_item_assignee: {
        Args: { p_explicit: string; p_item_type: string; p_project_id: string }
        Returns: string
      }
      suggest_code: { Args: { _name: string }; Returns: string }
      user_can_edit_diary_entry: {
        Args: { p_created_by: string; p_project_id: string }
        Returns: boolean
      }
      user_can_read_work_item: {
        Args: { p_work_item_id: string }
        Returns: boolean
      }
      user_can_write_work_item: {
        Args: { p_item_type: string; p_project_id: string }
        Returns: boolean
      }
      working_days_between: {
        Args: {
          p_calendar: string
          p_from: string
          p_project: string
          p_to: string
        }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      attachments: {
        Row: {
          caption: string | null
          created_at: string
          entity_id: string
          entity_type: string
          file_name: string
          file_path: string
          file_size_bytes: number | null
          id: string
          mime_type: string | null
          organisation_id: string
          sort_order: number
          uploaded_by: string | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          file_name: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          organisation_id: string
          sort_order?: number
          uploaded_by?: string | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          file_name?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          mime_type?: string | null
          organisation_id?: string
          sort_order?: number
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "metric_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "attachments_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string
          entity_type: string
          id: string
          ip_address: unknown
          new_values: Json | null
          old_values: Json | null
          organisation_id: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id: string
          entity_type: string
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          organisation_id?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string
          id?: string
          ip_address?: unknown
          new_values?: Json | null
          old_values?: Json | null
          organisation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "metric_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      auth_events: {
        Row: {
          event_type: string
          id: string
          ip_address: unknown
          metadata: Json
          occurred_at: string
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          event_type: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          occurred_at?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          event_type?: string
          id?: string
          ip_address?: unknown
          metadata?: Json
          occurred_at?: string
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      email_events: {
        Row: {
          bounce_type: string | null
          entity_ref: string | null
          event_type: string
          id: string
          occurred_at: string
          payload: Json
          project_id: string | null
          received_at: string
          resend_message_id: string | null
          retrieved_at: string | null
          source: string
          subject: string | null
          to_email: string | null
          webhook_id: string
        }
        Insert: {
          bounce_type?: string | null
          entity_ref?: string | null
          event_type: string
          id?: string
          occurred_at: string
          payload?: Json
          project_id?: string | null
          received_at?: string
          resend_message_id?: string | null
          retrieved_at?: string | null
          source?: string
          subject?: string | null
          to_email?: string | null
          webhook_id: string
        }
        Update: {
          bounce_type?: string | null
          entity_ref?: string | null
          event_type?: string
          id?: string
          occurred_at?: string
          payload?: Json
          project_id?: string | null
          received_at?: string
          resend_message_id?: string | null
          retrieved_at?: string | null
          source?: string
          subject?: string | null
          to_email?: string | null
          webhook_id?: string
        }
        Relationships: []
      }
      email_sequence_events: {
        Row: {
          clicked_at: string | null
          failure_reason: string | null
          id: string
          metadata: Json
          opened_at: string | null
          organisation_id: string | null
          resend_message_id: string | null
          send_attempts: number
          sent_at: string
          sequence_name: string
          status: string
          step_name: string
          subject: string
          to_email: string
          user_id: string
        }
        Insert: {
          clicked_at?: string | null
          failure_reason?: string | null
          id?: string
          metadata?: Json
          opened_at?: string | null
          organisation_id?: string | null
          resend_message_id?: string | null
          send_attempts?: number
          sent_at?: string
          sequence_name: string
          status?: string
          step_name: string
          subject: string
          to_email: string
          user_id: string
        }
        Update: {
          clicked_at?: string | null
          failure_reason?: string | null
          id?: string
          metadata?: Json
          opened_at?: string | null
          organisation_id?: string | null
          resend_message_id?: string | null
          send_attempts?: number
          sent_at?: string
          sequence_name?: string
          status?: string
          step_name?: string
          subject?: string
          to_email?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_sequence_events_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      email_suppressions: {
        Row: {
          email_address: string
          first_suppressed_at: string
          last_event_at: string
          reason: string
          source_message_id: string | null
        }
        Insert: {
          email_address: string
          first_suppressed_at?: string
          last_event_at: string
          reason: string
          source_message_id?: string | null
        }
        Update: {
          email_address?: string
          first_suppressed_at?: string
          last_event_at?: string
          reason?: string
          source_message_id?: string | null
        }
        Relationships: []
      }
      metric_cohorts: {
        Row: {
          as_of: string
          cohort_key: string
          organisation_id: string
          user_id: string
        }
        Insert: {
          as_of: string
          cohort_key: string
          organisation_id: string
          user_id: string
        }
        Update: {
          as_of?: string
          cohort_key?: string
          organisation_id?: string
          user_id?: string
        }
        Relationships: []
      }
      notifications: {
        Row: {
          action_url: string | null
          body: string
          created_at: string
          data: Json
          entity_id: string | null
          entity_type: string | null
          id: string
          is_read: boolean
          organisation_id: string | null
          read_at: string | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          action_url?: string | null
          body?: string
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          organisation_id?: string | null
          read_at?: string | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          action_url?: string | null
          body?: string
          created_at?: string
          data?: Json
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_read?: boolean
          organisation_id?: string | null
          read_at?: string | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "metric_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      org_storage_connections: {
        Row: {
          access_token_enc: string
          account_email: string
          connected_by: string
          created_at: string
          expires_at: string | null
          id: string
          last_sync_error: string | null
          needs_reauth: boolean
          organisation_id: string
          provider: string
          refresh_token_enc: string
          scope: string | null
          team_id: string | null
          team_member_id: string | null
          team_name: string | null
          updated_at: string
        }
        Insert: {
          access_token_enc: string
          account_email: string
          connected_by: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_sync_error?: string | null
          needs_reauth?: boolean
          organisation_id: string
          provider: string
          refresh_token_enc: string
          scope?: string | null
          team_id?: string | null
          team_member_id?: string | null
          team_name?: string | null
          updated_at?: string
        }
        Update: {
          access_token_enc?: string
          account_email?: string
          connected_by?: string
          created_at?: string
          expires_at?: string | null
          id?: string
          last_sync_error?: string | null
          needs_reauth?: boolean
          organisation_id?: string
          provider?: string
          refresh_token_enc?: string
          scope?: string | null
          team_id?: string | null
          team_member_id?: string | null
          team_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_storage_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "metric_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "org_storage_connections_connected_by_fkey"
            columns: ["connected_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_storage_connections_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisation_health_scores: {
        Row: {
          calculated_at: string
          id: string
          organisation_id: string
          score: number
          signals: Json
          tier: string
          trend_30d: number | null
          trend_7d: number | null
        }
        Insert: {
          calculated_at?: string
          id?: string
          organisation_id: string
          score: number
          signals?: Json
          tier: string
          trend_30d?: number | null
          trend_7d?: number | null
        }
        Update: {
          calculated_at?: string
          id?: string
          organisation_id?: string
          score?: number
          signals?: Json
          tier?: string
          trend_30d?: number | null
          trend_7d?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "organisation_health_scores_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      organisations: {
        Row: {
          address: string | null
          city: string | null
          created_at: string
          id: string
          is_active: boolean
          is_shadow: boolean
          logo_url: string | null
          name: string
          parent_organisation_id: string | null
          paystack_customer_id: string | null
          phone: string | null
          province: string | null
          registration_no: string | null
          registration_number: string | null
          report_accent_color: string | null
          settings: Json
          signatory_name: string | null
          signatory_title: string | null
          slug: string
          storage_used_bytes: number
          subscription_tier: string
          type: string
          updated_at: string
          vat_number: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_shadow?: boolean
          logo_url?: string | null
          name: string
          parent_organisation_id?: string | null
          paystack_customer_id?: string | null
          phone?: string | null
          province?: string | null
          registration_no?: string | null
          registration_number?: string | null
          report_accent_color?: string | null
          settings?: Json
          signatory_name?: string | null
          signatory_title?: string | null
          // Auto-filled by the organisations_ensure_slug BEFORE INSERT trigger
          // (migration 00022); supabase gen types cannot see triggers.
          slug?: string
          storage_used_bytes?: number
          subscription_tier?: string
          type?: string
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          city?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          is_shadow?: boolean
          logo_url?: string | null
          name?: string
          parent_organisation_id?: string | null
          paystack_customer_id?: string | null
          phone?: string | null
          province?: string | null
          registration_no?: string | null
          registration_number?: string | null
          report_accent_color?: string | null
          settings?: Json
          signatory_name?: string | null
          signatory_title?: string | null
          slug?: string
          storage_used_bytes?: number
          subscription_tier?: string
          type?: string
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organisations_parent_organisation_id_fkey"
            columns: ["parent_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_metrics_weekly: {
        Row: {
          captured_at: string
          denominator: number | null
          detail: Json
          id: string
          is_baseline: boolean
          iso_week: number | null
          iso_year: number
          method_version: number
          metric_key: string
          note: string | null
          numerator: number | null
          status: string
          value: number | null
          window_end: string
          window_start: string
        }
        Insert: {
          captured_at?: string
          denominator?: number | null
          detail?: Json
          id?: string
          is_baseline?: boolean
          iso_week?: number | null
          iso_year: number
          method_version?: number
          metric_key: string
          note?: string | null
          numerator?: number | null
          status: string
          value?: number | null
          window_end: string
          window_start: string
        }
        Update: {
          captured_at?: string
          denominator?: number | null
          detail?: Json
          id?: string
          is_baseline?: boolean
          iso_week?: number | null
          iso_year?: number
          method_version?: number
          metric_key?: string
          note?: string | null
          numerator?: number | null
          status?: string
          value?: number | null
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      platform_tariff_admins: {
        Row: {
          added_at: string
          added_by: string | null
          user_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          user_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          user_id?: string
        }
        Relationships: []
      }
      product_events: {
        Row: {
          actor_id: string | null
          effective_role: string | null
          event: string
          id: string
          occurred_at: string
          organisation_id: string
          project_id: string | null
          properties: Json
          session_id: string | null
        }
        Insert: {
          actor_id?: string | null
          effective_role?: string | null
          event: string
          id?: string
          occurred_at?: string
          organisation_id: string
          project_id?: string | null
          properties?: Json
          session_id?: string | null
        }
        Update: {
          actor_id?: string | null
          effective_role?: string | null
          event?: string
          id?: string
          occurred_at?: string
          organisation_id?: string
          project_id?: string | null
          properties?: Json
          session_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "product_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "metric_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "product_events_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "product_events_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          active_organisation_id: string | null
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          marketing_emails_opted_out: boolean
          notification_preferences: Json
          phone: string | null
          popia_consent_at: string | null
          theme_preference: string
          updated_at: string
        }
        Insert: {
          active_organisation_id?: string | null
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          marketing_emails_opted_out?: boolean
          notification_preferences?: Json
          phone?: string | null
          popia_consent_at?: string | null
          theme_preference?: string
          updated_at?: string
        }
        Update: {
          active_organisation_id?: string | null
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          marketing_emails_opted_out?: boolean
          notification_preferences?: Json
          phone?: string | null
          popia_consent_at?: string | null
          theme_preference?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_active_organisation_id_fkey"
            columns: ["active_organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          platform?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "metric_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "push_tokens_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rfi_annotations: {
        Row: {
          annotation_data: Json
          attachment_id: string
          created_at: string
          created_by: string | null
          id: string
          organisation_id: string
          rfi_id: string
          source_floor_plan_id: string | null
          updated_at: string
        }
        Insert: {
          annotation_data: Json
          attachment_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          organisation_id: string
          rfi_id: string
          source_floor_plan_id?: string | null
          updated_at?: string
        }
        Update: {
          annotation_data?: Json
          attachment_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          organisation_id?: string
          rfi_id?: string
          source_floor_plan_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rfi_annotations_attachment_id_fkey"
            columns: ["attachment_id"]
            isOneToOne: true
            referencedRelation: "attachments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfi_annotations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "metric_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "rfi_annotations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rfi_annotations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_organisations: {
        Row: {
          accepted_at: string | null
          created_at: string
          id: string
          invited_by: string | null
          is_active: boolean
          organisation_id: string
          role: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          organisation_id: string
          role?: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          id?: string
          invited_by?: string | null
          is_active?: boolean
          organisation_id?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_organisations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "metric_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_organisations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organisations_organisation_id_fkey"
            columns: ["organisation_id"]
            isOneToOne: false
            referencedRelation: "organisations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_organisations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "metric_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_organisations_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_presence: {
        Row: {
          last_active_at: string
          platform: string
          user_id: string
        }
        Insert: {
          last_active_at?: string
          platform: string
          user_id: string
        }
        Update: {
          last_active_at?: string
          platform?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_presence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "metric_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_presence_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_sessions: {
        Row: {
          id: string
          last_seen_at: string
          platform: string
          started_at: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          id?: string
          last_seen_at?: string
          platform: string
          started_at?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          id?: string
          last_seen_at?: string
          platform?: string
          started_at?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "metric_accounts"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "user_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      metric_accounts: {
        Row: {
          email: string | null
          full_name: string | null
          user_id: string | null
        }
        Insert: {
          email?: string | null
          full_name?: string | null
          user_id?: string | null
        }
        Update: {
          email?: string | null
          full_name?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      caller_has_any_solar_org: { Args: never; Returns: boolean }
      compute_platform_metrics_weekly: {
        Args: {
          p_is_baseline?: boolean
          p_window_end: string
          p_window_start: string
        }
        Returns: number
      }
      custom_jwt_claims: { Args: { event: Json }; Returns: Json }
      emit_product_event: {
        Args: {
          p_actor_id: string
          p_event?: string
          p_organisation_id?: string
          p_project_id?: string
          p_properties?: Json
          p_session_id?: string
        }
        Returns: string
      }
      floor_plan_project_id: {
        Args: { p_floor_plan_id: string }
        Returns: string
      }
      get_user_org_ids: { Args: never; Returns: string[] }
      get_user_org_ids_bypass: { Args: never; Returns: string[] }
      has_feature: {
        Args: { p_feature_key: string; p_org_id: string }
        Returns: boolean
      }
      has_feature_seat: {
        Args: { p_feature_key: string; p_org_id: string; p_user_id: string }
        Returns: boolean
      }
      is_platform_tariff_admin: { Args: never; Returns: boolean }
      metric_account_excluded: { Args: { p_email: string }; Returns: boolean }
      org_has_solar: { Args: { p_org_id: string }; Returns: boolean }
      project_notification_recipients: {
        Args: { p_exclude_user?: string; p_project_id: string }
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      report_kind_is_sensitive: { Args: { _kind: string }; Returns: boolean }
      report_path_belongs: {
        Args: { _org: string; _path: string; _project: string }
        Returns: boolean
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      solar_access_level: { Args: { p_project_id: string }; Returns: string }
      solar_can_edit: { Args: { p_project_id: string }; Returns: boolean }
      solar_can_see_money: { Args: { p_project_id: string }; Returns: boolean }
      solar_can_view: { Args: { p_project_id: string }; Returns: boolean }
      solar_is_grantor: { Args: { p_project_id: string }; Returns: boolean }
      solar_issue_proposal: {
        Args: {
          p_actor: string
          p_case_run_id: string
          p_expected_updated_at: string
          p_expires_at: string
          p_pdf_path: string
          p_pdf_sha256: string
          p_proposal_id: string
          p_report_id: string
          p_snapshot: Json
          p_token_hash: string
        }
        Returns: Json
      }
      solar_ops_monthly_kwh: {
        Args: { p_installation_id: string; p_role: string }
        Returns: Json
      }
      solar_ops_series: {
        Args: { p_installation_id: string; p_month: string; p_role: string }
        Returns: Json
      }
      solar_portal_proposal: {
        Args: {
          p_ip: string
          p_project_id: string
          p_proposal_id: string
          p_ua: string
          p_user_id: string
        }
        Returns: Json
      }
      solar_portal_proposals: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: Json
      }
      solar_portal_respond: {
        Args: {
          p_authority: boolean
          p_decision: string
          p_email: string
          p_ip: string
          p_name: string
          p_project_id: string
          p_proposal_id: string
          p_reason: string
          p_signature: string
          p_ua: string
          p_user_id: string
        }
        Returns: Json
      }
      solar_portfolio: {
        Args: { p_org_id: string }
        Returns: {
          can_see_money: boolean
          city: string
          last_activity: string
          licensee_name: string
          project_id: string
          project_name: string
          proposed_kwp: number
          province: string
          selected_case_name: string
          selected_kwp: number
          stage: string
          year1_saving_zar: number
        }[]
      }
      solar_proposal_by_token: {
        Args: { p_ip?: string; p_token: string; p_ua?: string }
        Returns: Json
      }
      solar_proposal_respond_by_token: {
        Args: {
          p_authority: boolean
          p_decision: string
          p_email: string
          p_ip: string
          p_name: string
          p_reason: string
          p_signature: string
          p_token: string
          p_ua: string
        }
        Returns: Json
      }
      solar_rotate_proposal_link: {
        Args: { p_actor: string; p_proposal_id: string; p_token_hash: string }
        Returns: Json
      }
      solar_save_layout_objects: {
        Args: {
          p_deletes: string[]
          p_expected_updated_at: string
          p_layout_id: string
          p_summary: Json
          p_upserts: Json
        }
        Returns: string
      }
      solar_save_schematic: {
        Args: {
          p_cards: Json
          p_expected_updated_at: string
          p_lines: Json
          p_schematic_id: string
        }
        Returns: string
      }
      solar_withdraw_proposal: {
        Args: { p_actor: string; p_proposal_id: string }
        Returns: Json
      }
      touch_presence: {
        Args: { p_platform?: string; p_user_agent?: string }
        Returns: undefined
      }
      user_can_manage_project: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      user_can_manage_project_members: {
        Args: { p_project_id: string }
        Returns: boolean
      }
      user_can_read_report_kind: {
        Args: { _kind: string; _project_id: string }
        Returns: boolean
      }
      user_effective_project_role: {
        Args: { p_project_id: string; p_user_id?: string }
        Returns: string
      }
      user_has_mv_access: { Args: { p_user_id: string }; Returns: boolean }
      user_has_project_access: {
        Args: { _project_id: string }
        Returns: boolean
      }
      user_is_client_viewer: { Args: { org_id: string }; Returns: boolean }
      user_is_org_admin:
        | { Args: never; Returns: boolean }
        | { Args: { p_org_id: string }; Returns: boolean }
    }
    Enums: {
      diary_entry_type:
        | "progress"
        | "safety"
        | "quality"
        | "delay"
        | "weather"
        | "workforce"
        | "general"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  solar: {
    Tables: {
      access_requests: {
        Row: {
          approved_level: string | null
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          kind: string
          note: string | null
          organisation_id: string
          project_id: string
          requested_level: string | null
          requester_id: string
          status: string
        }
        Insert: {
          approved_level?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          kind: string
          note?: string | null
          organisation_id: string
          project_id: string
          requested_level?: string | null
          requester_id: string
          status?: string
        }
        Update: {
          approved_level?: string | null
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          kind?: string
          note?: string | null
          organisation_id?: string
          project_id?: string
          requested_level?: string | null
          requester_id?: string
          status?: string
        }
        Relationships: []
      }
      audit_events: {
        Row: {
          actor_id: string | null
          created_at: string
          id: number
          object_ref: Json
          organisation_id: string
          project_id: string
          verb: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          id?: never
          object_ref?: Json
          organisation_id: string
          project_id: string
          verb: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          id?: never
          object_ref?: Json
          organisation_id?: string
          project_id?: string
          verb?: string
        }
        Relationships: []
      }
      bill_checks: {
        Row: {
          actual_total_excl_vat: number
          billing_month: string
          created_at: string
          created_by: string | null
          difference_pct: number
          engine_version: string
          id: string
          import_kwh_off_peak: number
          import_kwh_peak: number
          import_kwh_standard: number
          max_demand_kva: number | null
          modelled: Json
          modelled_total_excl_vat: number
          note: string | null
          organisation_id: string
          project_id: string
          study_id: string
          tariff_id: string | null
          tariff_override_id: string | null
        }
        Insert: {
          actual_total_excl_vat: number
          billing_month: string
          created_at?: string
          created_by?: string | null
          difference_pct: number
          engine_version: string
          id?: string
          import_kwh_off_peak?: number
          import_kwh_peak?: number
          import_kwh_standard?: number
          max_demand_kva?: number | null
          modelled?: Json
          modelled_total_excl_vat: number
          note?: string | null
          organisation_id: string
          project_id: string
          study_id: string
          tariff_id?: string | null
          tariff_override_id?: string | null
        }
        Update: {
          actual_total_excl_vat?: number
          billing_month?: string
          created_at?: string
          created_by?: string | null
          difference_pct?: number
          engine_version?: string
          id?: string
          import_kwh_off_peak?: number
          import_kwh_peak?: number
          import_kwh_standard?: number
          max_demand_kva?: number | null
          modelled?: Json
          modelled_total_excl_vat?: number
          note?: string | null
          organisation_id?: string
          project_id?: string
          study_id?: string
          tariff_id?: string | null
          tariff_override_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bill_checks_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_checks_tariff_override_id_fkey"
            columns: ["tariff_override_id"]
            isOneToOne: false
            referencedRelation: "tariff_overrides"
            referencedColumns: ["id"]
          },
        ]
      }
      case_financials: {
        Row: {
          case_id: string
          config: Json
          config_version: number
          created_at: string
          created_by: string | null
          organisation_id: string
          project_id: string
          study_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          case_id: string
          config: Json
          config_version?: number
          created_at?: string
          created_by?: string | null
          organisation_id: string
          project_id: string
          study_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          case_id?: string
          config?: Json
          config_version?: number
          created_at?: string
          created_by?: string | null
          organisation_id?: string
          project_id?: string
          study_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "case_financials_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: true
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_financials_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      case_run_financials: {
        Row: {
          case_id: string
          case_run_id: string
          created_at: string
          engine_version: string
          fin_inputs: Json
          fin_inputs_hash: string
          id: string
          organisation_id: string
          project_id: string
          results: Json
          run_by: string | null
          tariff_ref: Json
        }
        Insert: {
          case_id: string
          case_run_id: string
          created_at?: string
          engine_version: string
          fin_inputs: Json
          fin_inputs_hash: string
          id?: string
          organisation_id: string
          project_id: string
          results: Json
          run_by?: string | null
          tariff_ref: Json
        }
        Update: {
          case_id?: string
          case_run_id?: string
          created_at?: string
          engine_version?: string
          fin_inputs?: Json
          fin_inputs_hash?: string
          id?: string
          organisation_id?: string
          project_id?: string
          results?: Json
          run_by?: string | null
          tariff_ref?: Json
        }
        Relationships: [
          {
            foreignKeyName: "case_run_financials_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_run_financials_case_run_id_fkey"
            columns: ["case_run_id"]
            isOneToOne: false
            referencedRelation: "case_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      case_runs: {
        Row: {
          case_id: string
          config_snapshot: Json
          engine_version: string
          error: string | null
          finished_at: string | null
          hourly_path: string | null
          id: string
          inputs: Json
          inputs_hash: string
          organisation_id: string
          outputs: Json | null
          project_id: string
          run_by: string | null
          started_at: string
          status: string
          study_id: string
          tariff_ref: Json | null
          weather_dataset_id: string
        }
        Insert: {
          case_id: string
          config_snapshot: Json
          engine_version: string
          error?: string | null
          finished_at?: string | null
          hourly_path?: string | null
          id?: string
          inputs: Json
          inputs_hash: string
          organisation_id: string
          outputs?: Json | null
          project_id: string
          run_by?: string | null
          started_at?: string
          status?: string
          study_id: string
          tariff_ref?: Json | null
          weather_dataset_id: string
        }
        Update: {
          case_id?: string
          config_snapshot?: Json
          engine_version?: string
          error?: string | null
          finished_at?: string | null
          hourly_path?: string | null
          id?: string
          inputs?: Json
          inputs_hash?: string
          organisation_id?: string
          outputs?: Json | null
          project_id?: string
          run_by?: string | null
          started_at?: string
          status?: string
          study_id?: string
          tariff_ref?: Json | null
          weather_dataset_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "case_runs_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_runs_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "case_runs_weather_dataset_id_fkey"
            columns: ["weather_dataset_id"]
            isOneToOne: false
            referencedRelation: "weather_datasets"
            referencedColumns: ["id"]
          },
        ]
      }
      cases: {
        Row: {
          config: Json
          config_version: number
          created_at: string
          created_by: string | null
          id: string
          layout_id: string | null
          name: string
          organisation_id: string
          project_id: string
          pv_source: string
          study_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          config: Json
          config_version?: number
          created_at?: string
          created_by?: string | null
          id?: string
          layout_id?: string | null
          name: string
          organisation_id: string
          project_id: string
          pv_source?: string
          study_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          config?: Json
          config_version?: number
          created_at?: string
          created_by?: string | null
          id?: string
          layout_id?: string | null
          name?: string
          organisation_id?: string
          project_id?: string
          pv_source?: string
          study_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "cases_layout_fk"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "layouts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cases_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      downtime: {
        Row: {
          cause: string
          created_at: string
          created_by: string | null
          description: string | null
          ends_at: string
          excluded_from_guarantee: boolean
          id: string
          installation_id: string
          organisation_id: string
          project_id: string
          source: string
          starts_at: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          cause: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at: string
          excluded_from_guarantee?: boolean
          id?: string
          installation_id: string
          organisation_id: string
          project_id: string
          source?: string
          starts_at: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          cause?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          ends_at?: string
          excluded_from_guarantee?: boolean
          id?: string
          installation_id?: string
          organisation_id?: string
          project_id?: string
          source?: string
          starts_at?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "downtime_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "installations"
            referencedColumns: ["id"]
          },
        ]
      }
      downtime_history: {
        Row: {
          actor_id: string | null
          at: string
          downtime_id: string
          id: number
          installation_id: string
          old_row: Json
          op: string
          organisation_id: string
          project_id: string
        }
        Insert: {
          actor_id?: string | null
          at?: string
          downtime_id: string
          id?: never
          installation_id: string
          old_row: Json
          op: string
          organisation_id: string
          project_id: string
        }
        Update: {
          actor_id?: string | null
          at?: string
          downtime_id?: string
          id?: never
          installation_id?: string
          old_row?: Json
          op?: string
          organisation_id?: string
          project_id?: string
        }
        Relationships: []
      }
      equipment: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: string
          make: string
          model: string
          organisation_id: string | null
          retired_at: string | null
          source: string
          specs: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: string
          make: string
          model: string
          organisation_id?: string | null
          retired_at?: string | null
          source?: string
          specs: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          make?: string
          model?: string
          organisation_id?: string | null
          retired_at?: string | null
          source?: string
          specs?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      guarantees: {
        Row: {
          basis: string
          created_at: string
          degradation_pct_per_year: number
          installation_id: string
          manual_monthly_kwh: number[] | null
          organisation_id: string
          pct: number | null
          project_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          basis: string
          created_at?: string
          degradation_pct_per_year?: number
          installation_id: string
          manual_monthly_kwh?: number[] | null
          organisation_id: string
          pct?: number | null
          project_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          basis?: string
          created_at?: string
          degradation_pct_per_year?: number
          installation_id?: string
          manual_monthly_kwh?: number[] | null
          organisation_id?: string
          pct?: number | null
          project_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "guarantees_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: true
            referencedRelation: "installations"
            referencedColumns: ["id"]
          },
        ]
      }
      handover_items: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          created_at: string
          document_id: string | null
          id: string
          installation_id: string
          item_key: string
          label: string
          not_applicable: boolean
          note: string | null
          organisation_id: string
          project_id: string
          required: boolean
          sort_order: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          installation_id: string
          item_key: string
          label: string
          not_applicable?: boolean
          note?: string | null
          organisation_id: string
          project_id: string
          required?: boolean
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          created_at?: string
          document_id?: string | null
          id?: string
          installation_id?: string
          item_key?: string
          label?: string
          not_applicable?: boolean
          note?: string | null
          organisation_id?: string
          project_id?: string
          required?: boolean
          sort_order?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "handover_items_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "installations"
            referencedColumns: ["id"]
          },
        ]
      }
      handover_templates: {
        Row: {
          created_at: string
          items: Json
          name: string
          organisation_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          items: Json
          name?: string
          organisation_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          items?: Json
          name?: string
          organisation_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      installation_meters: {
        Row: {
          added_at: string
          added_by: string | null
          expected_share_pct: number | null
          installation_id: string
          meter_id: string
          organisation_id: string
          project_id: string
          role: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          expected_share_pct?: number | null
          installation_id: string
          meter_id: string
          organisation_id: string
          project_id: string
          role: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          expected_share_pct?: number | null
          installation_id?: string
          meter_id?: string
          organisation_id?: string
          project_id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "installation_meters_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "installations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installation_meters_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
        ]
      }
      installations: {
        Row: {
          as_built: Json
          baseline: Json
          commissioning_date: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          organisation_id: string
          project_id: string
          proposal_id: string | null
          study_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          as_built: Json
          baseline: Json
          commissioning_date?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organisation_id: string
          project_id: string
          proposal_id?: string | null
          study_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          as_built?: Json
          baseline?: Json
          commissioning_date?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          organisation_id?: string
          project_id?: string
          proposal_id?: string | null
          study_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "installations_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "installations_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: true
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      layout_objects: {
        Row: {
          created_at: string
          created_by: string | null
          floor_plan_id: string | null
          geometry: Json
          id: string
          kind: string
          layout_id: string
          organisation_id: string
          page_index: number | null
          pixels_per_meter: number | null
          project_id: string
          props: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          floor_plan_id?: string | null
          geometry: Json
          id?: string
          kind: string
          layout_id: string
          organisation_id: string
          page_index?: number | null
          pixels_per_meter?: number | null
          project_id: string
          props?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          floor_plan_id?: string | null
          geometry?: Json
          id?: string
          kind?: string
          layout_id?: string
          organisation_id?: string
          page_index?: number | null
          pixels_per_meter?: number | null
          project_id?: string
          props?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "layout_objects_layout_id_fkey"
            columns: ["layout_id"]
            isOneToOne: false
            referencedRelation: "layouts"
            referencedColumns: ["id"]
          },
        ]
      }
      layouts: {
        Row: {
          created_at: string
          created_by: string | null
          default_tilt_deg: number
          design_t_amb_max_c: number
          design_t_min_c: number
          id: string
          module_id: string | null
          module_spec: Json
          name: string
          organisation_id: string
          project_id: string
          roof_source_id: string
          study_id: string
          summary: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          default_tilt_deg?: number
          design_t_amb_max_c?: number
          design_t_min_c?: number
          id?: string
          module_id?: string | null
          module_spec: Json
          name: string
          organisation_id: string
          project_id: string
          roof_source_id: string
          study_id: string
          summary?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          default_tilt_deg?: number
          design_t_amb_max_c?: number
          design_t_min_c?: number
          id?: string
          module_id?: string | null
          module_spec?: Json
          name?: string
          organisation_id?: string
          project_id?: string
          roof_source_id?: string
          study_id?: string
          summary?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "layouts_module_fk"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layouts_roof_source_id_fkey"
            columns: ["roof_source_id"]
            isOneToOne: false
            referencedRelation: "roof_sources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "layouts_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      load_archetypes: {
        Row: {
          code: string
          created_at: string
          is_current: boolean
          name: string
          operating: Json
          profiles: Json
          seasonal: Json
          version: number
        }
        Insert: {
          code: string
          created_at?: string
          is_current?: boolean
          name: string
          operating: Json
          profiles: Json
          seasonal: Json
          version: number
        }
        Update: {
          code?: string
          created_at?: string
          is_current?: boolean
          name?: string
          operating?: Json
          profiles?: Json
          seasonal?: Json
          version?: number
        }
        Relationships: []
      }
      load_check_acks: {
        Row: {
          acknowledged_at: string
          acknowledged_by: string | null
          check_key: string
          id: string
          note: string | null
          organisation_id: string
          project_id: string
          study_id: string
        }
        Insert: {
          acknowledged_at?: string
          acknowledged_by?: string | null
          check_key: string
          id?: string
          note?: string | null
          organisation_id: string
          project_id: string
          study_id: string
        }
        Update: {
          acknowledged_at?: string
          acknowledged_by?: string | null
          check_key?: string
          id?: string
          note?: string | null
          organisation_id?: string
          project_id?: string
          study_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "load_check_acks_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      meter_channels: {
        Row: {
          coverage_only: boolean
          created_at: string
          direction: string
          file_id: string | null
          id: string
          interval_min: number
          is_cumulative: boolean
          is_primary: boolean
          meter_id: string
          organisation_id: string
          parser_version: string
          phase: string | null
          quantity: string
          source_column: string
          source_unit: string
          tz_convention: string
          unit: string
          updated_at: string
        }
        Insert: {
          coverage_only?: boolean
          created_at?: string
          direction: string
          file_id?: string | null
          id?: string
          interval_min: number
          is_cumulative?: boolean
          is_primary?: boolean
          meter_id: string
          organisation_id: string
          parser_version: string
          phase?: string | null
          quantity: string
          source_column: string
          source_unit: string
          tz_convention: string
          unit: string
          updated_at?: string
        }
        Update: {
          coverage_only?: boolean
          created_at?: string
          direction?: string
          file_id?: string | null
          id?: string
          interval_min?: number
          is_cumulative?: boolean
          is_primary?: boolean
          meter_id?: string
          organisation_id?: string
          parser_version?: string
          phase?: string | null
          quantity?: string
          source_column?: string
          source_unit?: string
          tz_convention?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "meter_channels_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "meter_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meter_channels_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
        ]
      }
      meter_files: {
        Row: {
          body_sha256: string | null
          created_at: string
          decimal_sep: string | null
          delimiter: string | null
          detected_format: string | null
          encoding: string | null
          header_row: number | null
          id: string
          organisation_id: string
          original_name: string
          parsed_filename: Json | null
          project_id: string
          row_order: string | null
          sha256: string
          size_bytes: number
          skip_reason: string | null
          source_serials: string[]
          status: string
          storage_path: string
          ts_convention: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          body_sha256?: string | null
          created_at?: string
          decimal_sep?: string | null
          delimiter?: string | null
          detected_format?: string | null
          encoding?: string | null
          header_row?: number | null
          id?: string
          organisation_id: string
          original_name: string
          parsed_filename?: Json | null
          project_id: string
          row_order?: string | null
          sha256: string
          size_bytes: number
          skip_reason?: string | null
          source_serials?: string[]
          status?: string
          storage_path: string
          ts_convention?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          body_sha256?: string | null
          created_at?: string
          decimal_sep?: string | null
          delimiter?: string | null
          detected_format?: string | null
          encoding?: string | null
          header_row?: number | null
          id?: string
          organisation_id?: string
          original_name?: string
          parsed_filename?: Json | null
          project_id?: string
          row_order?: string | null
          sha256?: string
          size_bytes?: number
          skip_reason?: string | null
          source_serials?: string[]
          status?: string
          storage_path?: string
          ts_convention?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: []
      }
      meter_import_reports: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          created_at: string
          created_by: string | null
          file_id: string
          id: string
          options: Json
          organisation_id: string
          parser_version: string
          report: Json
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          file_id: string
          id?: string
          options?: Json
          organisation_id: string
          parser_version: string
          report: Json
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          created_at?: string
          created_by?: string | null
          file_id?: string
          id?: string
          options?: Json
          organisation_id?: string
          parser_version?: string
          report?: Json
        }
        Relationships: [
          {
            foreignKeyName: "meter_import_reports_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "meter_files"
            referencedColumns: ["id"]
          },
        ]
      }
      meter_readings: {
        Row: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value: number | null
        }
        Insert: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value?: number | null
        }
        Update: {
          channel_id?: string
          organisation_id?: string
          quality?: number
          ts_end?: string
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "meter_readings_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "meter_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      meter_readings_p0: {
        Row: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value: number | null
        }
        Insert: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value?: number | null
        }
        Update: {
          channel_id?: string
          organisation_id?: string
          quality?: number
          ts_end?: string
          value?: number | null
        }
        Relationships: []
      }
      meter_readings_p1: {
        Row: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value: number | null
        }
        Insert: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value?: number | null
        }
        Update: {
          channel_id?: string
          organisation_id?: string
          quality?: number
          ts_end?: string
          value?: number | null
        }
        Relationships: []
      }
      meter_readings_p2: {
        Row: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value: number | null
        }
        Insert: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value?: number | null
        }
        Update: {
          channel_id?: string
          organisation_id?: string
          quality?: number
          ts_end?: string
          value?: number | null
        }
        Relationships: []
      }
      meter_readings_p3: {
        Row: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value: number | null
        }
        Insert: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value?: number | null
        }
        Update: {
          channel_id?: string
          organisation_id?: string
          quality?: number
          ts_end?: string
          value?: number | null
        }
        Relationships: []
      }
      meter_readings_p4: {
        Row: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value: number | null
        }
        Insert: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value?: number | null
        }
        Update: {
          channel_id?: string
          organisation_id?: string
          quality?: number
          ts_end?: string
          value?: number | null
        }
        Relationships: []
      }
      meter_readings_p5: {
        Row: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value: number | null
        }
        Insert: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value?: number | null
        }
        Update: {
          channel_id?: string
          organisation_id?: string
          quality?: number
          ts_end?: string
          value?: number | null
        }
        Relationships: []
      }
      meter_readings_p6: {
        Row: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value: number | null
        }
        Insert: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value?: number | null
        }
        Update: {
          channel_id?: string
          organisation_id?: string
          quality?: number
          ts_end?: string
          value?: number | null
        }
        Relationships: []
      }
      meter_readings_p7: {
        Row: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value: number | null
        }
        Insert: {
          channel_id: string
          organisation_id: string
          quality: number
          ts_end: string
          value?: number | null
        }
        Update: {
          channel_id?: string
          organisation_id?: string
          quality?: number
          ts_end?: string
          value?: number | null
        }
        Relationships: []
      }
      meter_register: {
        Row: {
          area_m2: number | null
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          created_by: string | null
          downloaded: boolean | null
          file_name: string | null
          id: string
          kind: string
          mall_name: string | null
          match_method: string
          organisation_id: string
          qa: Json
          serial: string | null
          shop_no: string | null
          site_label: string | null
          source_file_id: string | null
          tenant_name: string | null
        }
        Insert: {
          area_m2?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          downloaded?: boolean | null
          file_name?: string | null
          id?: string
          kind: string
          mall_name?: string | null
          match_method?: string
          organisation_id: string
          qa?: Json
          serial?: string | null
          shop_no?: string | null
          site_label?: string | null
          source_file_id?: string | null
          tenant_name?: string | null
        }
        Update: {
          area_m2?: number | null
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          created_by?: string | null
          downloaded?: boolean | null
          file_name?: string | null
          id?: string
          kind?: string
          mall_name?: string | null
          match_method?: string
          organisation_id?: string
          qa?: Json
          serial?: string | null
          shop_no?: string | null
          site_label?: string | null
          source_file_id?: string | null
          tenant_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meter_register_source_file_id_fkey"
            columns: ["source_file_id"]
            isOneToOne: false
            referencedRelation: "meter_files"
            referencedColumns: ["id"]
          },
        ]
      }
      meter_series_hashes: {
        Row: {
          body_hash: string
          created_at: string
          file_id: string
          id: number
          meter_id: string
          organisation_id: string
        }
        Insert: {
          body_hash: string
          created_at?: string
          file_id: string
          id?: never
          meter_id: string
          organisation_id: string
        }
        Update: {
          body_hash?: string
          created_at?: string
          file_id?: string
          id?: never
          meter_id?: string
          organisation_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "meter_series_hashes_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "meter_files"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meter_series_hashes_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
        ]
      }
      meters: {
        Row: {
          area_m2: number | null
          area_source: string | null
          created_at: string
          created_by: string | null
          existing_pv_channel_id: string | null
          id: string
          kind: string
          label: string
          node_id: string | null
          organisation_id: string
          parent_meter_id: string | null
          serials: string[]
          shop_no: string | null
          site_label: string | null
          supply_point_confirmed: boolean
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          area_m2?: number | null
          area_source?: string | null
          created_at?: string
          created_by?: string | null
          existing_pv_channel_id?: string | null
          id?: string
          kind?: string
          label: string
          node_id?: string | null
          organisation_id: string
          parent_meter_id?: string | null
          serials?: string[]
          shop_no?: string | null
          site_label?: string | null
          supply_point_confirmed?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          area_m2?: number | null
          area_source?: string | null
          created_at?: string
          created_by?: string | null
          existing_pv_channel_id?: string | null
          id?: string
          kind?: string
          label?: string
          node_id?: string | null
          organisation_id?: string
          parent_meter_id?: string | null
          serials?: string[]
          shop_no?: string | null
          site_label?: string | null
          supply_point_confirmed?: boolean
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meters_existing_pv_channel_fk"
            columns: ["existing_pv_channel_id"]
            isOneToOne: false
            referencedRelation: "meter_channels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "meters_parent_meter_id_fkey"
            columns: ["parent_meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_report_notes: {
        Row: {
          body: string
          created_at: string
          installation_id: string
          organisation_id: string
          period_month: string
          project_id: string
          section: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body: string
          created_at?: string
          installation_id: string
          organisation_id: string
          period_month: string
          project_id: string
          section: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          installation_id?: string
          organisation_id?: string
          period_month?: string
          project_id?: string
          section?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "monthly_report_notes_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "installations"
            referencedColumns: ["id"]
          },
        ]
      }
      monthly_reports: {
        Row: {
          generated_at: string
          generated_by: string | null
          id: string
          installation_id: string
          organisation_id: string
          pdf_sha256: string
          period_month: string
          project_id: string
          report_id: string | null
          snapshot: Json
          snapshot_sha256: string
          version: number
        }
        Insert: {
          generated_at?: string
          generated_by?: string | null
          id?: string
          installation_id: string
          organisation_id: string
          pdf_sha256: string
          period_month: string
          project_id: string
          report_id?: string | null
          snapshot: Json
          snapshot_sha256: string
          version: number
        }
        Update: {
          generated_at?: string
          generated_by?: string | null
          id?: string
          installation_id?: string
          organisation_id?: string
          pdf_sha256?: string
          period_month?: string
          project_id?: string
          report_id?: string | null
          snapshot?: Json
          snapshot_sha256?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "monthly_reports_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "installations"
            referencedColumns: ["id"]
          },
        ]
      }
      ops_irradiation: {
        Row: {
          created_at: string
          installation_id: string
          kwh_per_m2: number
          month: string
          organisation_id: string
          plane: string
          project_id: string
          source_note: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          installation_id: string
          kwh_per_m2: number
          month: string
          organisation_id: string
          plane: string
          project_id: string
          source_note: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          installation_id?: string
          kwh_per_m2?: number
          month?: string
          organisation_id?: string
          plane?: string
          project_id?: string
          source_note?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_irradiation_installation_id_fkey"
            columns: ["installation_id"]
            isOneToOne: false
            referencedRelation: "installations"
            referencedColumns: ["id"]
          },
        ]
      }
      org_settings: {
        Row: {
          created_at: string
          organisation_id: string
          settings: Json
          updated_at: string
          updated_by: string | null
          version: number
        }
        Insert: {
          created_at?: string
          organisation_id: string
          settings?: Json
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Update: {
          created_at?: string
          organisation_id?: string
          settings?: Json
          updated_at?: string
          updated_by?: string | null
          version?: number
        }
        Relationships: []
      }
      project_access: {
        Row: {
          granted_at: string
          granted_by: string | null
          level: string
          organisation_id: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          granted_at?: string
          granted_by?: string | null
          level: string
          organisation_id: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          granted_at?: string
          granted_by?: string | null
          level?: string
          organisation_id?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      proposal_events: {
        Row: {
          actor_email: string | null
          actor_name: string | null
          actor_user_id: string | null
          at: string
          authority_confirmed: boolean | null
          id: number
          ip: string | null
          kind: string
          organisation_id: string
          pdf_sha256: string | null
          project_id: string
          proposal_id: string
          reason: string | null
          signature_png: string | null
          user_agent: string | null
          via: string
        }
        Insert: {
          actor_email?: string | null
          actor_name?: string | null
          actor_user_id?: string | null
          at?: string
          authority_confirmed?: boolean | null
          id?: never
          ip?: string | null
          kind: string
          organisation_id: string
          pdf_sha256?: string | null
          project_id: string
          proposal_id: string
          reason?: string | null
          signature_png?: string | null
          user_agent?: string | null
          via: string
        }
        Update: {
          actor_email?: string | null
          actor_name?: string | null
          actor_user_id?: string | null
          at?: string
          authority_confirmed?: boolean | null
          id?: never
          ip?: string | null
          kind?: string
          organisation_id?: string
          pdf_sha256?: string | null
          project_id?: string
          proposal_id?: string
          reason?: string | null
          signature_png?: string | null
          user_agent?: string | null
          via?: string
        }
        Relationships: [
          {
            foreignKeyName: "proposal_events_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      proposal_templates: {
        Row: {
          created_at: string
          disclaimer_text: string
          organisation_id: string
          terms_text: string
          updated_at: string
          updated_by: string | null
          validity_days: number
        }
        Insert: {
          created_at?: string
          disclaimer_text?: string
          organisation_id: string
          terms_text?: string
          updated_at?: string
          updated_by?: string | null
          validity_days?: number
        }
        Update: {
          created_at?: string
          disclaimer_text?: string
          organisation_id?: string
          terms_text?: string
          updated_at?: string
          updated_by?: string | null
          validity_days?: number
        }
        Relationships: []
      }
      proposals: {
        Row: {
          case_id: string | null
          case_run_id: string | null
          created_at: string
          created_by: string | null
          draft: Json
          expires_at: string | null
          family_id: string
          id: string
          issued_at: string | null
          issued_by: string | null
          organisation_id: string
          pdf_path: string | null
          pdf_sha256: string | null
          project_id: string
          report_id: string | null
          responded_at: string | null
          share_token_hash: string | null
          snapshot: Json | null
          status: string
          study_id: string
          updated_at: string
          updated_by: string | null
          version: number
          withdrawn_at: string | null
          withdrawn_by: string | null
        }
        Insert: {
          case_id?: string | null
          case_run_id?: string | null
          created_at?: string
          created_by?: string | null
          draft?: Json
          expires_at?: string | null
          family_id: string
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          organisation_id: string
          pdf_path?: string | null
          pdf_sha256?: string | null
          project_id: string
          report_id?: string | null
          responded_at?: string | null
          share_token_hash?: string | null
          snapshot?: Json | null
          status?: string
          study_id: string
          updated_at?: string
          updated_by?: string | null
          version: number
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Update: {
          case_id?: string | null
          case_run_id?: string | null
          created_at?: string
          created_by?: string | null
          draft?: Json
          expires_at?: string | null
          family_id?: string
          id?: string
          issued_at?: string | null
          issued_by?: string | null
          organisation_id?: string
          pdf_path?: string | null
          pdf_sha256?: string | null
          project_id?: string
          report_id?: string | null
          responded_at?: string | null
          share_token_hash?: string | null
          snapshot?: Json | null
          status?: string
          study_id?: string
          updated_at?: string
          updated_by?: string | null
          version?: number
          withdrawn_at?: string | null
          withdrawn_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "proposals_case_id_fkey"
            columns: ["case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_case_run_id_fkey"
            columns: ["case_run_id"]
            isOneToOne: false
            referencedRelation: "case_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "proposals_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      roof_sources: {
        Row: {
          attribution: string | null
          capture_meta: Json
          created_at: string
          created_by: string | null
          file_path: string | null
          floor_plan_id: string | null
          id: string
          kind: string
          m_per_px: number | null
          north_bearing_deg: number | null
          north_points: Json | null
          organisation_id: string
          page_index: number
          project_id: string
          source_revision_id: string | null
          storage_path: string | null
          study_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          attribution?: string | null
          capture_meta?: Json
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          floor_plan_id?: string | null
          id?: string
          kind: string
          m_per_px?: number | null
          north_bearing_deg?: number | null
          north_points?: Json | null
          organisation_id: string
          page_index?: number
          project_id: string
          source_revision_id?: string | null
          storage_path?: string | null
          study_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          attribution?: string | null
          capture_meta?: Json
          created_at?: string
          created_by?: string | null
          file_path?: string | null
          floor_plan_id?: string | null
          id?: string
          kind?: string
          m_per_px?: number | null
          north_bearing_deg?: number | null
          north_points?: Json | null
          organisation_id?: string
          page_index?: number
          project_id?: string
          source_revision_id?: string | null
          storage_path?: string | null
          study_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "roof_sources_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_baseline_tasks: {
        Row: {
          baseline_id: string
          end_date: string
          id: string
          is_milestone: boolean
          name: string
          organisation_id: string
          project_id: string
          sort_order: number
          start_date: string
          task_id: string | null
          work_item_ref: string
        }
        Insert: {
          baseline_id: string
          end_date: string
          id?: string
          is_milestone?: boolean
          name: string
          organisation_id: string
          project_id: string
          sort_order?: number
          start_date: string
          task_id?: string | null
          work_item_ref: string
        }
        Update: {
          baseline_id?: string
          end_date?: string
          id?: string
          is_milestone?: boolean
          name?: string
          organisation_id?: string
          project_id?: string
          sort_order?: number
          start_date?: string
          task_id?: string | null
          work_item_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_baseline_tasks_baseline_id_fkey"
            columns: ["baseline_id"]
            isOneToOne: false
            referencedRelation: "schedule_baselines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_baseline_tasks_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "schedule_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_baselines: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          duration_mode: string
          id: string
          name: string
          organisation_id: string
          project_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_mode?: string
          id?: string
          name: string
          organisation_id: string
          project_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          duration_mode?: string
          id?: string
          name?: string
          organisation_id?: string
          project_id?: string
        }
        Relationships: []
      }
      schedule_dependencies: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          lag_days: number
          link_type: string
          organisation_id: string
          predecessor_task_id: string
          project_id: string
          successor_task_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          lag_days?: number
          link_type?: string
          organisation_id: string
          predecessor_task_id: string
          project_id: string
          successor_task_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          lag_days?: number
          link_type?: string
          organisation_id?: string
          predecessor_task_id?: string
          project_id?: string
          successor_task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_dependencies_predecessor_task_id_fkey"
            columns: ["predecessor_task_id"]
            isOneToOne: false
            referencedRelation: "schedule_tasks"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_dependencies_successor_task_id_fkey"
            columns: ["successor_task_id"]
            isOneToOne: false
            referencedRelation: "schedule_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_filter_presets: {
        Row: {
          created_at: string
          filters: Json
          id: string
          name: string
          organisation_id: string
          project_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filters: Json
          id?: string
          name: string
          organisation_id: string
          project_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          filters?: Json
          id?: string
          name?: string
          organisation_id?: string
          project_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      schedule_segments: {
        Row: {
          created_at: string
          end_date: string
          id: string
          organisation_id: string
          project_id: string
          start_date: string
          task_id: string
        }
        Insert: {
          created_at?: string
          end_date: string
          id?: string
          organisation_id: string
          project_id: string
          start_date: string
          task_id: string
        }
        Update: {
          created_at?: string
          end_date?: string
          id?: string
          organisation_id?: string
          project_id?: string
          start_date?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_segments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "schedule_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_settings: {
        Row: {
          created_at: string
          duration_mode: string
          organisation_id: string
          project_id: string
          updated_at: string
          updated_by: string | null
          workload_threshold: number
        }
        Insert: {
          created_at?: string
          duration_mode?: string
          organisation_id: string
          project_id: string
          updated_at?: string
          updated_by?: string | null
          workload_threshold?: number
        }
        Update: {
          created_at?: string
          duration_mode?: string
          organisation_id?: string
          project_id?: string
          updated_at?: string
          updated_by?: string | null
          workload_threshold?: number
        }
        Relationships: []
      }
      schedule_tasks: {
        Row: {
          category: string
          colour: string
          created_at: string
          created_by: string | null
          description: string
          end_date: string
          gantt_status: string
          id: string
          is_milestone: boolean
          organisation_id: string
          progress: number
          project_id: string
          sort_order: number
          start_date: string
          updated_at: string
          updated_by: string | null
          work_item_id: string
          zone: string
        }
        Insert: {
          category?: string
          colour?: string
          created_at?: string
          created_by?: string | null
          description?: string
          end_date: string
          gantt_status?: string
          id?: string
          is_milestone?: boolean
          organisation_id: string
          progress?: number
          project_id: string
          sort_order?: number
          start_date: string
          updated_at?: string
          updated_by?: string | null
          work_item_id: string
          zone?: string
        }
        Update: {
          category?: string
          colour?: string
          created_at?: string
          created_by?: string | null
          description?: string
          end_date?: string
          gantt_status?: string
          id?: string
          is_milestone?: boolean
          organisation_id?: string
          progress?: number
          project_id?: string
          sort_order?: number
          start_date?: string
          updated_at?: string
          updated_by?: string | null
          work_item_id?: string
          zone?: string
        }
        Relationships: []
      }
      schedule_templates: {
        Row: {
          content: Json
          created_at: string
          organisation_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content: Json
          created_at?: string
          organisation_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: Json
          created_at?: string
          organisation_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      schematic_cards: {
        Row: {
          colour: string | null
          created_at: string
          floor_plan_id: string | null
          h: number
          id: string
          meter_id: string
          organisation_id: string
          project_id: string
          schematic_id: string
          updated_at: string
          w: number
          x: number
          y: number
        }
        Insert: {
          colour?: string | null
          created_at?: string
          floor_plan_id?: string | null
          h: number
          id?: string
          meter_id: string
          organisation_id: string
          project_id: string
          schematic_id: string
          updated_at?: string
          w: number
          x: number
          y: number
        }
        Update: {
          colour?: string | null
          created_at?: string
          floor_plan_id?: string | null
          h?: number
          id?: string
          meter_id?: string
          organisation_id?: string
          project_id?: string
          schematic_id?: string
          updated_at?: string
          w?: number
          x?: number
          y?: number
        }
        Relationships: [
          {
            foreignKeyName: "schematic_cards_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schematic_cards_schematic_id_fkey"
            columns: ["schematic_id"]
            isOneToOne: false
            referencedRelation: "schematics"
            referencedColumns: ["id"]
          },
        ]
      }
      schematic_lines: {
        Row: {
          created_at: string
          floor_plan_id: string | null
          from_meter_id: string
          id: string
          line_type: string
          organisation_id: string
          project_id: string
          schematic_id: string
          to_meter_id: string
          updated_at: string
          waypoints: Json
        }
        Insert: {
          created_at?: string
          floor_plan_id?: string | null
          from_meter_id: string
          id?: string
          line_type?: string
          organisation_id: string
          project_id: string
          schematic_id: string
          to_meter_id: string
          updated_at?: string
          waypoints?: Json
        }
        Update: {
          created_at?: string
          floor_plan_id?: string | null
          from_meter_id?: string
          id?: string
          line_type?: string
          organisation_id?: string
          project_id?: string
          schematic_id?: string
          to_meter_id?: string
          updated_at?: string
          waypoints?: Json
        }
        Relationships: [
          {
            foreignKeyName: "schematic_lines_from_meter_id_fkey"
            columns: ["from_meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schematic_lines_schematic_id_fkey"
            columns: ["schematic_id"]
            isOneToOne: false
            referencedRelation: "schematics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schematic_lines_to_meter_id_fkey"
            columns: ["to_meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
        ]
      }
      schematics: {
        Row: {
          canvas_h: number
          canvas_w: number
          created_at: string
          created_by: string | null
          description: string | null
          file_path: string | null
          floor_plan_id: string | null
          id: string
          kind: string
          name: string
          organisation_id: string
          page_index: number
          project_id: string
          source_revision_id: string | null
          study_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          canvas_h?: number
          canvas_w?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_path?: string | null
          floor_plan_id?: string | null
          id?: string
          kind: string
          name: string
          organisation_id: string
          page_index?: number
          project_id: string
          source_revision_id?: string | null
          study_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          canvas_h?: number
          canvas_w?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          file_path?: string | null
          floor_plan_id?: string | null
          id?: string
          kind?: string
          name?: string
          organisation_id?: string
          page_index?: number
          project_id?: string
          source_revision_id?: string | null
          study_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "schematics_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      site_load: {
        Row: {
          basis: string
          built_at: string
          built_by: string | null
          coverage: Json
          engine_version: string
          id: string
          inputs_hash: string
          md_monthly: Json
          organisation_id: string
          project_id: string
          reference_year: number
          series: number[]
          study_id: string
        }
        Insert: {
          basis: string
          built_at?: string
          built_by?: string | null
          coverage?: Json
          engine_version: string
          id?: string
          inputs_hash: string
          md_monthly?: Json
          organisation_id: string
          project_id: string
          reference_year: number
          series: number[]
          study_id: string
        }
        Update: {
          basis?: string
          built_at?: string
          built_by?: string | null
          coverage?: Json
          engine_version?: string
          id?: string
          inputs_hash?: string
          md_monthly?: Json
          organisation_id?: string
          project_id?: string
          reference_year?: number
          series?: number[]
          study_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "site_load_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      studies: {
        Row: {
          common_area_pct: number
          constraints_note: string | null
          created_at: string
          created_by: string | null
          diversity_factor: number
          elevation_m: number | null
          escalation: Json | null
          export_limit_kw: number | null
          export_mode: string | null
          export_rule: Json | null
          id: string
          latitude: number | null
          licensee_id: string | null
          licensee_name: string | null
          load_basis: string | null
          load_growth_pct: number
          longitude: number | null
          monthly_bills: Json | null
          nmd_kva: number | null
          organisation_id: string
          poc_node_id: string | null
          project_id: string
          reference_year: number | null
          schematic_waived: boolean
          selected_case_id: string | null
          supply_type: string | null
          supply_voltage_v: number | null
          tariff_id: string | null
          tariff_override_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          common_area_pct?: number
          constraints_note?: string | null
          created_at?: string
          created_by?: string | null
          diversity_factor?: number
          elevation_m?: number | null
          escalation?: Json | null
          export_limit_kw?: number | null
          export_mode?: string | null
          export_rule?: Json | null
          id?: string
          latitude?: number | null
          licensee_id?: string | null
          licensee_name?: string | null
          load_basis?: string | null
          load_growth_pct?: number
          longitude?: number | null
          monthly_bills?: Json | null
          nmd_kva?: number | null
          organisation_id: string
          poc_node_id?: string | null
          project_id: string
          reference_year?: number | null
          schematic_waived?: boolean
          selected_case_id?: string | null
          supply_type?: string | null
          supply_voltage_v?: number | null
          tariff_id?: string | null
          tariff_override_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          common_area_pct?: number
          constraints_note?: string | null
          created_at?: string
          created_by?: string | null
          diversity_factor?: number
          elevation_m?: number | null
          escalation?: Json | null
          export_limit_kw?: number | null
          export_mode?: string | null
          export_rule?: Json | null
          id?: string
          latitude?: number | null
          licensee_id?: string | null
          licensee_name?: string | null
          load_basis?: string | null
          load_growth_pct?: number
          longitude?: number | null
          monthly_bills?: Json | null
          nmd_kva?: number | null
          organisation_id?: string
          poc_node_id?: string | null
          project_id?: string
          reference_year?: number | null
          schematic_waived?: boolean
          selected_case_id?: string | null
          supply_type?: string | null
          supply_voltage_v?: number | null
          tariff_id?: string | null
          tariff_override_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "studies_selected_case_fk"
            columns: ["selected_case_id"]
            isOneToOne: false
            referencedRelation: "cases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "studies_tariff_override_id_fkey"
            columns: ["tariff_override_id"]
            isOneToOne: false
            referencedRelation: "tariff_overrides"
            referencedColumns: ["id"]
          },
        ]
      }
      study_export_rates: {
        Row: {
          amount_excl_vat: number
          created_at: string
          created_by: string | null
          id: string
          organisation_id: string
          project_id: string
          season: string
          source_note: string
          study_id: string
          tou: string
          unit: string
          updated_at: string
        }
        Insert: {
          amount_excl_vat: number
          created_at?: string
          created_by?: string | null
          id?: string
          organisation_id: string
          project_id: string
          season?: string
          source_note: string
          study_id: string
          tou?: string
          unit: string
          updated_at?: string
        }
        Update: {
          amount_excl_vat?: number
          created_at?: string
          created_by?: string | null
          id?: string
          organisation_id?: string
          project_id?: string
          season?: string
          source_note?: string
          study_id?: string
          tou?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_export_rates_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      study_meters: {
        Row: {
          added_at: string
          added_by: string | null
          meter_id: string
          organisation_id: string
          project_id: string
          study_id: string
        }
        Insert: {
          added_at?: string
          added_by?: string | null
          meter_id: string
          organisation_id: string
          project_id: string
          study_id: string
        }
        Update: {
          added_at?: string
          added_by?: string | null
          meter_id?: string
          organisation_id?: string
          project_id?: string
          study_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "study_meters_meter_id_fkey"
            columns: ["meter_id"]
            isOneToOne: false
            referencedRelation: "meters"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "study_meters_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      tariff_override_charges: {
        Row: {
          amount_excl_vat: number
          base_charge_id: string | null
          block_basis: string | null
          block_max_kwh: number | null
          block_min_kwh: number | null
          component: string
          created_at: string
          day_type: string
          demand_basis: string | null
          edited_at: string | null
          edited_by: string | null
          id: string
          organisation_id: string
          override_id: string
          project_id: string
          reason: string | null
          season: string
          source_locator: Json
          tou: string
          unit: string
          updated_at: string
          vat_basis: string
          vat_rate: number
        }
        Insert: {
          amount_excl_vat: number
          base_charge_id?: string | null
          block_basis?: string | null
          block_max_kwh?: number | null
          block_min_kwh?: number | null
          component: string
          created_at?: string
          day_type?: string
          demand_basis?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          organisation_id: string
          override_id: string
          project_id: string
          reason?: string | null
          season?: string
          source_locator?: Json
          tou?: string
          unit: string
          updated_at?: string
          vat_basis?: string
          vat_rate?: number
        }
        Update: {
          amount_excl_vat?: number
          base_charge_id?: string | null
          block_basis?: string | null
          block_max_kwh?: number | null
          block_min_kwh?: number | null
          component?: string
          created_at?: string
          day_type?: string
          demand_basis?: string | null
          edited_at?: string | null
          edited_by?: string | null
          id?: string
          organisation_id?: string
          override_id?: string
          project_id?: string
          reason?: string | null
          season?: string
          source_locator?: Json
          tou?: string
          unit?: string
          updated_at?: string
          vat_basis?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "tariff_override_charges_override_id_fkey"
            columns: ["override_id"]
            isOneToOne: false
            referencedRelation: "tariff_overrides"
            referencedColumns: ["id"]
          },
        ]
      }
      tariff_overrides: {
        Row: {
          base_tariff_id: string
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          organisation_id: string
          project_id: string
          study_id: string
          updated_at: string
        }
        Insert: {
          base_tariff_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          organisation_id: string
          project_id: string
          study_id: string
          updated_at?: string
        }
        Update: {
          base_tariff_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          organisation_id?: string
          project_id?: string
          study_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tariff_overrides_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: true
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_load_basis: {
        Row: {
          archetype: string | null
          created_at: string
          density_override_w_m2: number | null
          id: string
          meters: Json
          node_id: string
          organisation_id: string
          project_id: string
          source: string
          study_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          archetype?: string | null
          created_at?: string
          density_override_w_m2?: number | null
          id?: string
          meters?: Json
          node_id: string
          organisation_id: string
          project_id: string
          source: string
          study_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          archetype?: string | null
          created_at?: string
          density_override_w_m2?: number | null
          id?: string
          meters?: Json
          node_id?: string
          organisation_id?: string
          project_id?: string
          source?: string
          study_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_load_basis_study_id_fkey"
            columns: ["study_id"]
            isOneToOne: false
            referencedRelation: "studies"
            referencedColumns: ["id"]
          },
        ]
      }
      weather_datasets: {
        Row: {
          content_sha256: string
          elevation_m: number | null
          fetched_at: string
          fetched_by: string | null
          gsa_pvout_kwh_per_kwp: number | null
          id: string
          lat_round: number
          lng_round: number
          meta: Json
          organisation_id: string
          radiation_db: string | null
          source: string
          storage_path: string
        }
        Insert: {
          content_sha256: string
          elevation_m?: number | null
          fetched_at?: string
          fetched_by?: string | null
          gsa_pvout_kwh_per_kwp?: number | null
          id?: string
          lat_round: number
          lng_round: number
          meta?: Json
          organisation_id: string
          radiation_db?: string | null
          source: string
          storage_path: string
        }
        Update: {
          content_sha256?: string
          elevation_m?: number | null
          fetched_at?: string
          fetched_by?: string | null
          gsa_pvout_kwh_per_kwp?: number | null
          id?: string
          lat_round?: number
          lng_round?: number
          meta?: Json
          organisation_id?: string
          radiation_db?: string | null
          source?: string
          storage_path?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      channel_readings: {
        Args: { p_channel_ids: string[]; p_from: string; p_to: string }
        Returns: {
          channel: string
          quals: number[]
          ts_ends: string[]
          vals: number[]
        }[]
      }
      channel_summaries: {
        Args: { p_channel_ids: string[] }
        Returns: {
          channel: string
          first_ts: string
          last_ts: string
          max_value: number
          n_rows: number
          n_usable: number
          sum_value: number
        }[]
      }
      clear_channel_readings: {
        Args: { p_channel_id: string }
        Returns: number
      }
      create_tariff_override: {
        Args: { p_expected_updated_at: string; p_project_id: string }
        Returns: string
      }
      is_portal_member: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: boolean
      }
      library_orgs: { Args: { p_min: string }; Returns: string[] }
      linked_channel_ids: { Args: never; Returns: string[] }
      linked_meter_ids: { Args: never; Returns: string[] }
      org_subscription_active: { Args: { p_org_id: string }; Returns: boolean }
      proposal_client_view: {
        Args: { p_id: string; p_ip: string; p_ua: string; p_via: string }
        Returns: Json
      }
      proposal_effective_status: {
        Args: { p_expires_at: string; p_status: string }
        Returns: string
      }
      proposal_hash_token: { Args: { p_token: string }; Returns: string }
      proposal_record_response: {
        Args: {
          p_authority: boolean
          p_decision: string
          p_email: string
          p_id: string
          p_ip: string
          p_name: string
          p_reason: string
          p_signature: string
          p_ua: string
          p_user: string
          p_via: string
        }
        Returns: Json
      }
      raw_path_allowed: {
        Args: { p_name: string; p_need: string }
        Returns: boolean
      }
      revert_tariff_override: {
        Args: { p_expected_updated_at: string; p_project_id: string }
        Returns: undefined
      }
      save_export_rule: {
        Args: {
          p_expected_updated_at: string
          p_project_id: string
          p_rates: Json
          p_rule: Json
        }
        Returns: string
      }
      schedule_assert_editor: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      schedule_create_tasks: {
        Args: {
          p_links?: Json
          p_project_id: string
          p_replace?: boolean
          p_tasks: Json
        }
        Returns: Json
      }
      schedule_delete_tasks: {
        Args: { p_project_id: string; p_task_ids: string[] }
        Returns: number
      }
      schedule_org_template: { Args: { p_project_id: string }; Returns: Json }
      schedule_owner_candidates: {
        Args: { p_project_id: string }
        Returns: {
          email: string
          full_name: string
          user_id: string
        }[]
      }
      schedule_owner_is_eligible: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: boolean
      }
      schedule_remove_tasks: {
        Args: { p_project_id: string; p_task_ids: string[] }
        Returns: number
      }
      schedule_reorder: {
        Args: { p_ids: string[]; p_project_id: string }
        Returns: number
      }
      schedule_save_baseline: {
        Args: { p_description: string; p_name: string; p_project_id: string }
        Returns: string
      }
      schedule_update_tasks: {
        Args: { p_patches: Json; p_project_id: string }
        Returns: Json
      }
      try_uuid: { Args: { p: string }; Returns: string }
      user_max_grant_level: {
        Args: { p_project_id: string; p_user_id: string }
        Returns: string
      }
      work_item_visible: { Args: { p_work_item_id: string }; Returns: boolean }
      write_readings: {
        Args: {
          p_channel_id: string
          p_quality: number[]
          p_ts_end: string[]
          p_value: number[]
        }
        Returns: number
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  structure: {
    Tables: {
      node_circuits: {
        Row: {
          breaker_rating_a: number | null
          cable_size: string | null
          circuit_no: string
          created_at: string
          curve: string | null
          description: string | null
          id: string
          is_spare: boolean
          node_id: string
          phase: string | null
          poles: number | null
          sort_order: number
          updated_at: string
        }
        Insert: {
          breaker_rating_a?: number | null
          cable_size?: string | null
          circuit_no: string
          created_at?: string
          curve?: string | null
          description?: string | null
          id?: string
          is_spare?: boolean
          node_id: string
          phase?: string | null
          poles?: number | null
          sort_order?: number
          updated_at?: string
        }
        Update: {
          breaker_rating_a?: number | null
          cable_size?: string | null
          circuit_no?: string
          created_at?: string
          curve?: string | null
          description?: string | null
          id?: string
          is_spare?: boolean
          node_id?: string
          phase?: string | null
          poles?: number | null
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_circuits_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      node_order_documents: {
        Row: {
          created_at: string
          doc_type: string
          file_name: string
          id: string
          kind: string
          label: string | null
          node_order_id: string
          storage_path: string
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          doc_type: string
          file_name: string
          id?: string
          kind?: string
          label?: string | null
          node_order_id: string
          storage_path: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          doc_type?: string
          file_name?: string
          id?: string
          kind?: string
          label?: string | null
          node_order_id?: string
          storage_path?: string
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "node_order_documents_node_order_id_fkey"
            columns: ["node_order_id"]
            isOneToOne: false
            referencedRelation: "node_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      node_order_shop_drawings: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          file_name: string
          handover_category: string | null
          handover_document_id: string | null
          id: string
          node_order_id: string
          received_at: string | null
          status: string
          storage_path: string
          title: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          file_name: string
          handover_category?: string | null
          handover_document_id?: string | null
          id?: string
          node_order_id: string
          received_at?: string | null
          status?: string
          storage_path: string
          title?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          file_name?: string
          handover_category?: string | null
          handover_document_id?: string | null
          id?: string
          node_order_id?: string
          received_at?: string | null
          status?: string
          storage_path?: string
          title?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "node_order_shop_drawings_node_order_id_fkey"
            columns: ["node_order_id"]
            isOneToOne: false
            referencedRelation: "node_orders"
            referencedColumns: ["id"]
          },
        ]
      }
      node_orders: {
        Row: {
          created_at: string
          id: string
          label: string
          node_id: string
          notes: string | null
          ordered_at: string | null
          organisation_id: string
          project_id: string
          received_at: string | null
          scope_item_type_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          label: string
          node_id: string
          notes?: string | null
          ordered_at?: string | null
          organisation_id: string
          project_id: string
          received_at?: string | null
          scope_item_type_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          label?: string
          node_id?: string
          notes?: string | null
          ordered_at?: string | null
          organisation_id?: string
          project_id?: string
          received_at?: string | null
          scope_item_type_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "node_orders_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_orders_scope_item_type_id_fkey"
            columns: ["scope_item_type_id"]
            isOneToOne: false
            referencedRelation: "scope_item_types"
            referencedColumns: ["id"]
          },
        ]
      }
      nodes: {
        Row: {
          breaker_rating_a: number | null
          coc_required: boolean
          code: string
          created_at: string
          created_by: string | null
          custom_kind_label: string | null
          decommission_reason: string | null
          deleted_at: string | null
          deleted_by: string | null
          generator_participation: string
          handover_category: string | null
          id: string
          incomer_breaker_a: number | null
          incomer_capacity_a: number | null
          incomer_computed_at: string | null
          incomer_load_a: number | null
          incomer_multiple_feeds: boolean
          incomer_pole_config: string | null
          incomer_source_revision_id: string | null
          incomer_under_protected: boolean
          kind: string
          name: string | null
          notes: string | null
          organisation_id: string
          parent_node_id: string | null
          pole_config: string | null
          project_id: string
          rating_kva: number | null
          section: string | null
          shop_area_m2: number | null
          shop_category: string | null
          shop_name: string | null
          shop_number: string | null
          short_code: string | null
          status: string
          updated_at: string
          voltage_v: number | null
        }
        Insert: {
          breaker_rating_a?: number | null
          coc_required?: boolean
          code: string
          created_at?: string
          created_by?: string | null
          custom_kind_label?: string | null
          decommission_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          generator_participation?: string
          handover_category?: string | null
          id?: string
          incomer_breaker_a?: number | null
          incomer_capacity_a?: number | null
          incomer_computed_at?: string | null
          incomer_load_a?: number | null
          incomer_multiple_feeds?: boolean
          incomer_pole_config?: string | null
          incomer_source_revision_id?: string | null
          incomer_under_protected?: boolean
          kind: string
          name?: string | null
          notes?: string | null
          organisation_id: string
          parent_node_id?: string | null
          pole_config?: string | null
          project_id: string
          rating_kva?: number | null
          section?: string | null
          shop_area_m2?: number | null
          shop_category?: string | null
          shop_name?: string | null
          shop_number?: string | null
          short_code?: string | null
          status?: string
          updated_at?: string
          voltage_v?: number | null
        }
        Update: {
          breaker_rating_a?: number | null
          coc_required?: boolean
          code?: string
          created_at?: string
          created_by?: string | null
          custom_kind_label?: string | null
          decommission_reason?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          generator_participation?: string
          handover_category?: string | null
          id?: string
          incomer_breaker_a?: number | null
          incomer_capacity_a?: number | null
          incomer_computed_at?: string | null
          incomer_load_a?: number | null
          incomer_multiple_feeds?: boolean
          incomer_pole_config?: string | null
          incomer_source_revision_id?: string | null
          incomer_under_protected?: boolean
          kind?: string
          name?: string | null
          notes?: string | null
          organisation_id?: string
          parent_node_id?: string | null
          pole_config?: string | null
          project_id?: string
          rating_kva?: number | null
          section?: string | null
          shop_area_m2?: number | null
          shop_category?: string | null
          shop_name?: string | null
          shop_number?: string | null
          short_code?: string | null
          status?: string
          updated_at?: string
          voltage_v?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "nodes_parent_fk"
            columns: ["project_id", "parent_node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["project_id", "id"]
          },
        ]
      }
      scope_item_types: {
        Row: {
          created_at: string
          handover_category: string | null
          id: string
          key: string
          label: string
          organisation_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          handover_category?: string | null
          id?: string
          key: string
          label: string
          organisation_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          handover_category?: string | null
          id?: string
          key?: string
          label?: string
          organisation_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      tenant_details: {
        Row: {
          bo_date_override: string | null
          bo_period_days: number | null
          created_at: string
          db_earth_leakage_ma: number | null
          db_fed_from: string | null
          db_location: string | null
          id: string
          layout_issued_at: string | null
          layout_status: string
          legend_card_size: string
          node_id: string
          scope_not_required: boolean
          scope_status: string
          updated_at: string
        }
        Insert: {
          bo_date_override?: string | null
          bo_period_days?: number | null
          created_at?: string
          db_earth_leakage_ma?: number | null
          db_fed_from?: string | null
          db_location?: string | null
          id?: string
          layout_issued_at?: string | null
          layout_status?: string
          legend_card_size?: string
          node_id: string
          scope_not_required?: boolean
          scope_status?: string
          updated_at?: string
        }
        Update: {
          bo_date_override?: string | null
          bo_period_days?: number | null
          created_at?: string
          db_earth_leakage_ma?: number | null
          db_fed_from?: string | null
          db_location?: string | null
          id?: string
          layout_issued_at?: string | null
          layout_status?: string
          legend_card_size?: string
          node_id?: string
          scope_not_required?: boolean
          scope_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_details_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: true
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_document_revisions: {
        Row: {
          created_at: string
          file_name: string
          id: string
          issued_at: string
          note: string | null
          rev_label: string
          storage_path: string
          tenant_document_id: string
          uploaded_by: string | null
        }
        Insert: {
          created_at?: string
          file_name: string
          id?: string
          issued_at?: string
          note?: string | null
          rev_label: string
          storage_path: string
          tenant_document_id: string
          uploaded_by?: string | null
        }
        Update: {
          created_at?: string
          file_name?: string
          id?: string
          issued_at?: string
          note?: string | null
          rev_label?: string
          storage_path?: string
          tenant_document_id?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_document_revisions_tenant_document_id_fkey"
            columns: ["tenant_document_id"]
            isOneToOne: false
            referencedRelation: "tenant_documents"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_documents: {
        Row: {
          created_at: string
          id: string
          kind: string
          node_id: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          node_id: string
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          node_id?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_documents_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_scope_items: {
        Row: {
          created_at: string
          id: string
          node_id: string
          party: string
          scope_item_type_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          node_id: string
          party: string
          scope_item_type_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          node_id?: string
          party?: string
          scope_item_type_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_scope_items_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_scope_items_scope_item_type_id_fkey"
            columns: ["scope_item_type_id"]
            isOneToOne: false
            referencedRelation: "scope_item_types"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_units: {
        Row: {
          area_m2: number | null
          created_at: string
          id: string
          node_id: string
          shop_number: string | null
          updated_at: string
        }
        Insert: {
          area_m2?: number | null
          created_at?: string
          id?: string
          node_id: string
          shop_number?: string | null
          updated_at?: string
        }
        Update: {
          area_m2?: number | null
          created_at?: string
          id?: string
          node_id?: string
          shop_number?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_units_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "nodes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      node_order_project_id: {
        Args: { p_node_order_id: string }
        Returns: string
      }
      recompute_tenant_doc_status: {
        Args: { p_kind: string; p_node_id: string }
        Returns: undefined
      }
      tenant_doc_project_id: { Args: { object_name: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  suppliers: {
    Tables: {
      organisation_suppliers: {
        Row: {
          account_number: string | null
          contractor_org_id: string
          credit_limit: number | null
          currency: string
          id: string
          is_preferred: boolean
          linked_at: string
          payment_terms_days: number | null
          supplier_id: string
        }
        Insert: {
          account_number?: string | null
          contractor_org_id: string
          credit_limit?: number | null
          currency?: string
          id?: string
          is_preferred?: boolean
          linked_at?: string
          payment_terms_days?: number | null
          supplier_id: string
        }
        Update: {
          account_number?: string | null
          contractor_org_id?: string
          credit_limit?: number | null
          currency?: string
          id?: string
          is_preferred?: boolean
          linked_at?: string
          payment_terms_days?: number | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organisation_suppliers_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_contacts: {
        Row: {
          created_at: string
          email: string | null
          id: string
          is_primary: boolean
          name: string
          phone: string | null
          role: string | null
          supplier_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name: string
          phone?: string | null
          role?: string | null
          supplier_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          is_primary?: boolean
          name?: string
          phone?: string | null
          role?: string | null
          supplier_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_contacts_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          address: string | null
          categories: string[]
          created_at: string
          id: string
          is_active: boolean
          is_verified: boolean
          name: string
          organisation_id: string | null
          province: string | null
          registration_no: string | null
          trading_name: string | null
          updated_at: string
          vat_number: string | null
          website: string | null
        }
        Insert: {
          address?: string | null
          categories?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          is_verified?: boolean
          name: string
          organisation_id?: string | null
          province?: string | null
          registration_no?: string | null
          trading_name?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Update: {
          address?: string | null
          categories?: string[]
          created_at?: string
          id?: string
          is_active?: boolean
          is_verified?: boolean
          name?: string
          organisation_id?: string | null
          province?: string | null
          registration_no?: string | null
          trading_name?: string | null
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  tariffs: {
    Tables: {
      charge: {
        Row: {
          amount_excl_vat: number
          block_basis: string | null
          block_max_kwh: number | null
          block_min_kwh: number | null
          component: string
          created_at: string
          day_type: string
          demand_basis: string | null
          extraction_method: string
          id: string
          inference_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          season: string
          source_document_id: string | null
          source_locator: Json
          tariff_id: string
          tou: string
          unit: string
          unit_inferred: boolean
          vat_basis: string
          vat_rate: number
        }
        Insert: {
          amount_excl_vat: number
          block_basis?: string | null
          block_max_kwh?: number | null
          block_min_kwh?: number | null
          component: string
          created_at?: string
          day_type?: string
          demand_basis?: string | null
          extraction_method: string
          id?: string
          inference_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          season?: string
          source_document_id?: string | null
          source_locator?: Json
          tariff_id: string
          tou?: string
          unit: string
          unit_inferred?: boolean
          vat_basis: string
          vat_rate?: number
        }
        Update: {
          amount_excl_vat?: number
          block_basis?: string | null
          block_max_kwh?: number | null
          block_min_kwh?: number | null
          component?: string
          created_at?: string
          day_type?: string
          demand_basis?: string | null
          extraction_method?: string
          id?: string
          inference_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          season?: string
          source_document_id?: string | null
          source_locator?: Json
          tariff_id?: string
          tou?: string
          unit?: string
          unit_inferred?: boolean
          vat_basis?: string
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "charge_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "charge_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariff"
            referencedColumns: ["id"]
          },
        ]
      }
      due_year_alert: {
        Row: {
          checked_on: string
          created_at: string
          id: string
          latest_published_fy: string | null
          licensee_id: string
          missing_financial_year: string
          regime: string
          resolved_at: string | null
        }
        Insert: {
          checked_on: string
          created_at?: string
          id?: string
          latest_published_fy?: string | null
          licensee_id: string
          missing_financial_year: string
          regime: string
          resolved_at?: string | null
        }
        Update: {
          checked_on?: string
          created_at?: string
          id?: string
          latest_published_fy?: string | null
          licensee_id?: string
          missing_financial_year?: string
          regime?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "due_year_alert_licensee_id_fkey"
            columns: ["licensee_id"]
            isOneToOne: false
            referencedRelation: "licensee"
            referencedColumns: ["id"]
          },
        ]
      }
      error_report: {
        Row: {
          created_at: string
          id: string
          note: string
          project_id: string
          reporter_id: string | null
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: string
          tariff_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          note: string
          project_id: string
          reporter_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tariff_id: string
        }
        Update: {
          created_at?: string
          id?: string
          note?: string
          project_id?: string
          reporter_id?: string | null
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: string
          tariff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "error_report_tariff_id_fkey"
            columns: ["tariff_id"]
            isOneToOne: false
            referencedRelation: "tariff"
            referencedColumns: ["id"]
          },
        ]
      }
      holiday_rule: {
        Row: {
          calendar_id: string
          treated_as: string
        }
        Insert: {
          calendar_id: string
          treated_as: string
        }
        Update: {
          calendar_id?: string
          treated_as?: string
        }
        Relationships: [
          {
            foreignKeyName: "holiday_rule_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: true
            referencedRelation: "tou_calendar"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_job: {
        Row: {
          claimed_at: string | null
          create_licensees: boolean
          error: string | null
          financial_year: string
          finished_at: string | null
          id: string
          ingest_run_id: string | null
          licensee_name: string | null
          parser: string
          report: Json | null
          requested_at: string
          requested_by: string | null
          source_document_id: string
          status: string
        }
        Insert: {
          claimed_at?: string | null
          create_licensees?: boolean
          error?: string | null
          financial_year: string
          finished_at?: string | null
          id?: string
          ingest_run_id?: string | null
          licensee_name?: string | null
          parser: string
          report?: Json | null
          requested_at?: string
          requested_by?: string | null
          source_document_id: string
          status?: string
        }
        Update: {
          claimed_at?: string | null
          create_licensees?: boolean
          error?: string | null
          financial_year?: string
          finished_at?: string | null
          id?: string
          ingest_run_id?: string | null
          licensee_name?: string | null
          parser?: string
          report?: Json | null
          requested_at?: string
          requested_by?: string | null
          source_document_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingest_job_ingest_run_id_fkey"
            columns: ["ingest_run_id"]
            isOneToOne: false
            referencedRelation: "ingest_run"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ingest_job_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_document"
            referencedColumns: ["id"]
          },
        ]
      }
      ingest_run: {
        Row: {
          at: string
          diff: Json
          error: string | null
          finished_at: string | null
          id: string
          parser: string
          source_document_id: string | null
          started_by: string | null
          stats: Json
          status: string
        }
        Insert: {
          at?: string
          diff?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          parser: string
          source_document_id?: string | null
          started_by?: string | null
          stats?: Json
          status: string
        }
        Update: {
          at?: string
          diff?: Json
          error?: string | null
          finished_at?: string | null
          id?: string
          parser?: string
          source_document_id?: string | null
          started_by?: string | null
          stats?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingest_run_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_document"
            referencedColumns: ["id"]
          },
        ]
      }
      licensee: {
        Row: {
          created_at: string
          id: string
          kind: string
          mdb_code: string | null
          name: string
          nersa_licence_no: string | null
          parent_licensee_id: string | null
          province: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          mdb_code?: string | null
          name: string
          nersa_licence_no?: string | null
          parent_licensee_id?: string | null
          province?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          mdb_code?: string | null
          name?: string
          nersa_licence_no?: string | null
          parent_licensee_id?: string | null
          province?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "licensee_parent_licensee_id_fkey"
            columns: ["parent_licensee_id"]
            isOneToOne: false
            referencedRelation: "licensee"
            referencedColumns: ["id"]
          },
        ]
      }
      licensee_alias: {
        Row: {
          alias: string
          created_at: string
          licensee_id: string
        }
        Insert: {
          alias: string
          created_at?: string
          licensee_id: string
        }
        Update: {
          alias?: string
          created_at?: string
          licensee_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "licensee_alias_licensee_id_fkey"
            columns: ["licensee_id"]
            isOneToOne: false
            referencedRelation: "licensee"
            referencedColumns: ["id"]
          },
        ]
      }
      loss_factor: {
        Row: {
          created_at: string
          factor: number
          id: string
          kind: string
          licensee_id: string
          source_locator: Json
          tariff_year_id: string
          transmission_zone: number | null
          voltage_band: string | null
        }
        Insert: {
          created_at?: string
          factor: number
          id?: string
          kind: string
          licensee_id: string
          source_locator?: Json
          tariff_year_id: string
          transmission_zone?: number | null
          voltage_band?: string | null
        }
        Update: {
          created_at?: string
          factor?: number
          id?: string
          kind?: string
          licensee_id?: string
          source_locator?: Json
          tariff_year_id?: string
          transmission_zone?: number | null
          voltage_band?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loss_factor_licensee_id_fkey"
            columns: ["licensee_id"]
            isOneToOne: false
            referencedRelation: "licensee"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loss_factor_tariff_year_id_fkey"
            columns: ["tariff_year_id"]
            isOneToOne: false
            referencedRelation: "tariff_year"
            referencedColumns: ["id"]
          },
        ]
      }
      source_document: {
        Row: {
          created_at: string
          financial_year: string | null
          id: string
          kind: string
          licensee_id: string | null
          page_count: number | null
          published_on: string | null
          retrieved_at: string | null
          sha256: string | null
          status: string
          storage_path: string | null
          title: string
          url: string | null
        }
        Insert: {
          created_at?: string
          financial_year?: string | null
          id?: string
          kind: string
          licensee_id?: string | null
          page_count?: number | null
          published_on?: string | null
          retrieved_at?: string | null
          sha256?: string | null
          status: string
          storage_path?: string | null
          title: string
          url?: string | null
        }
        Update: {
          created_at?: string
          financial_year?: string | null
          id?: string
          kind?: string
          licensee_id?: string | null
          page_count?: number | null
          published_on?: string | null
          retrieved_at?: string | null
          sha256?: string | null
          status?: string
          storage_path?: string | null
          title?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "source_document_licensee_id_fkey"
            columns: ["licensee_id"]
            isOneToOne: false
            referencedRelation: "licensee"
            referencedColumns: ["id"]
          },
        ]
      }
      sseg_rule: {
        Row: {
          cap_rule: string
          carry_forward: string
          created_at: string
          crediting: string
          forfeit_on_ownership_change: boolean
          fy_end_month: number
          id: string
          licensee_id: string
          locator: Json
          max_kva: number
          offsets: string
          requires_bidirectional_meter: boolean
          requires_tou: boolean
          settlement_period: string
          source_document_id: string | null
          tariff_year_id: string
          updated_at: string
        }
        Insert: {
          cap_rule: string
          carry_forward: string
          created_at?: string
          crediting: string
          forfeit_on_ownership_change?: boolean
          fy_end_month: number
          id?: string
          licensee_id: string
          locator?: Json
          max_kva?: number
          offsets?: string
          requires_bidirectional_meter?: boolean
          requires_tou?: boolean
          settlement_period?: string
          source_document_id?: string | null
          tariff_year_id: string
          updated_at?: string
        }
        Update: {
          cap_rule?: string
          carry_forward?: string
          created_at?: string
          crediting?: string
          forfeit_on_ownership_change?: boolean
          fy_end_month?: number
          id?: string
          licensee_id?: string
          locator?: Json
          max_kva?: number
          offsets?: string
          requires_bidirectional_meter?: boolean
          requires_tou?: boolean
          settlement_period?: string
          source_document_id?: string | null
          tariff_year_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sseg_rule_licensee_id_fkey"
            columns: ["licensee_id"]
            isOneToOne: false
            referencedRelation: "licensee"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sseg_rule_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_document"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sseg_rule_tariff_year_id_fkey"
            columns: ["tariff_year_id"]
            isOneToOne: true
            referencedRelation: "tariff_year"
            referencedColumns: ["id"]
          },
        ]
      }
      tariff: {
        Row: {
          category: string
          code: string | null
          created_at: string
          eligibility: Json
          export_tariff_id: string | null
          family: string | null
          id: string
          is_legacy: boolean
          local_authority: boolean
          max_amps: number | null
          max_kva: number | null
          metering: string
          min_amps: number | null
          min_kva: number | null
          name: string
          notes: string | null
          phase: string | null
          predecessor_tariff_id: string | null
          source_locator: Json
          structure: string
          tariff_year_id: string
          transmission_zone: number | null
          updated_at: string
          voltage_band: string | null
        }
        Insert: {
          category?: string
          code?: string | null
          created_at?: string
          eligibility?: Json
          export_tariff_id?: string | null
          family?: string | null
          id?: string
          is_legacy?: boolean
          local_authority?: boolean
          max_amps?: number | null
          max_kva?: number | null
          metering?: string
          min_amps?: number | null
          min_kva?: number | null
          name: string
          notes?: string | null
          phase?: string | null
          predecessor_tariff_id?: string | null
          source_locator?: Json
          structure: string
          tariff_year_id: string
          transmission_zone?: number | null
          updated_at?: string
          voltage_band?: string | null
        }
        Update: {
          category?: string
          code?: string | null
          created_at?: string
          eligibility?: Json
          export_tariff_id?: string | null
          family?: string | null
          id?: string
          is_legacy?: boolean
          local_authority?: boolean
          max_amps?: number | null
          max_kva?: number | null
          metering?: string
          min_amps?: number | null
          min_kva?: number | null
          name?: string
          notes?: string | null
          phase?: string | null
          predecessor_tariff_id?: string | null
          source_locator?: Json
          structure?: string
          tariff_year_id?: string
          transmission_zone?: number | null
          updated_at?: string
          voltage_band?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tariff_export_tariff_id_fkey"
            columns: ["export_tariff_id"]
            isOneToOne: false
            referencedRelation: "tariff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariff_predecessor_tariff_id_fkey"
            columns: ["predecessor_tariff_id"]
            isOneToOne: false
            referencedRelation: "tariff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariff_tariff_year_id_fkey"
            columns: ["tariff_year_id"]
            isOneToOne: false
            referencedRelation: "tariff_year"
            referencedColumns: ["id"]
          },
        ]
      }
      tariff_year: {
        Row: {
          approved_increase_pct: number | null
          created_at: string
          effective_from: string
          effective_to: string
          financial_year: string
          id: string
          licensee_id: string
          published_at: string | null
          published_by: string | null
          source_document_id: string | null
          state: string
          superseded_at: string | null
          updated_at: string
          validated_at: string | null
          validation_blocking: number | null
        }
        Insert: {
          approved_increase_pct?: number | null
          created_at?: string
          effective_from: string
          effective_to: string
          financial_year: string
          id?: string
          licensee_id: string
          published_at?: string | null
          published_by?: string | null
          source_document_id?: string | null
          state?: string
          superseded_at?: string | null
          updated_at?: string
          validated_at?: string | null
          validation_blocking?: number | null
        }
        Update: {
          approved_increase_pct?: number | null
          created_at?: string
          effective_from?: string
          effective_to?: string
          financial_year?: string
          id?: string
          licensee_id?: string
          published_at?: string | null
          published_by?: string | null
          source_document_id?: string | null
          state?: string
          superseded_at?: string | null
          updated_at?: string
          validated_at?: string | null
          validation_blocking?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tariff_year_licensee_id_fkey"
            columns: ["licensee_id"]
            isOneToOne: false
            referencedRelation: "licensee"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tariff_year_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_document"
            referencedColumns: ["id"]
          },
        ]
      }
      tou_calendar: {
        Row: {
          created_at: string
          high_season_months: number[]
          id: string
          licensee_id: string
          source: string
          source_document_id: string | null
          updated_at: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          created_at?: string
          high_season_months: number[]
          id?: string
          licensee_id: string
          source: string
          source_document_id?: string | null
          updated_at?: string
          valid_from: string
          valid_to?: string | null
        }
        Update: {
          created_at?: string
          high_season_months?: number[]
          id?: string
          licensee_id?: string
          source?: string
          source_document_id?: string | null
          updated_at?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tou_calendar_licensee_id_fkey"
            columns: ["licensee_id"]
            isOneToOne: false
            referencedRelation: "licensee"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tou_calendar_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "source_document"
            referencedColumns: ["id"]
          },
        ]
      }
      tou_window: {
        Row: {
          calendar_id: string
          day_type: string
          end_minute: number
          id: string
          period: string
          season: string
          start_minute: number
        }
        Insert: {
          calendar_id: string
          day_type: string
          end_minute: number
          id?: string
          period: string
          season: string
          start_minute: number
        }
        Update: {
          calendar_id?: string
          day_type?: string
          end_minute?: number
          id?: string
          period?: string
          season?: string
          start_minute?: number
        }
        Relationships: [
          {
            foreignKeyName: "tou_window_calendar_id_fkey"
            columns: ["calendar_id"]
            isOneToOne: false
            referencedRelation: "tou_calendar"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_ingest_job: {
        Args: never
        Returns: {
          claimed_at: string | null
          create_licensees: boolean
          error: string | null
          financial_year: string
          finished_at: string | null
          id: string
          ingest_run_id: string | null
          licensee_name: string | null
          parser: string
          report: Json | null
          requested_at: string
          requested_by: string | null
          source_document_id: string
          status: string
        }[]
        SetofOptions: {
          from: "*"
          to: "ingest_job"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      record_due_year_alerts: {
        Args: { p_on?: string; p_regime: string }
        Returns: number
      }
      record_year_validation: {
        Args: { p_blocking: number; p_fingerprint: string; p_year_id: string }
        Returns: undefined
      }
      save_tou_calendar: {
        Args: {
          p_calendar: Json
          p_calendar_id: string
          p_expected_updated_at: string
          p_holiday: string
          p_windows: Json
        }
        Returns: Json
      }
      year_content_fingerprint: { Args: { p_year_id: string }; Returns: string }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  tenants: {
    Tables: {
      cloud_sync_runs: {
        Row: {
          created_at: string
          downloads: number | null
          error_text: string | null
          failed: number
          files_seen: number | null
          finished_at: string | null
          id: string
          intent: string | null
          new_versions: number
          organisation_id: string
          project_id: string
          remaining: number | null
          sent: number
          skipped: number
          started_at: string
          status: string
          trigger: string
          updated: number
          walk_complete: boolean | null
        }
        Insert: {
          created_at?: string
          downloads?: number | null
          error_text?: string | null
          failed?: number
          files_seen?: number | null
          finished_at?: string | null
          id?: string
          intent?: string | null
          new_versions?: number
          organisation_id: string
          project_id: string
          remaining?: number | null
          sent?: number
          skipped?: number
          started_at?: string
          status?: string
          trigger: string
          updated?: number
          walk_complete?: boolean | null
        }
        Update: {
          created_at?: string
          downloads?: number | null
          error_text?: string | null
          failed?: number
          files_seen?: number | null
          finished_at?: string | null
          id?: string
          intent?: string | null
          new_versions?: number
          organisation_id?: string
          project_id?: string
          remaining?: number | null
          sent?: number
          skipped?: number
          started_at?: string
          status?: string
          trigger?: string
          updated?: number
          walk_complete?: boolean | null
        }
        Relationships: []
      }
      documents: {
        Row: {
          category: string | null
          cloud_mirror_file_id: string | null
          cloud_mirror_path: string | null
          cloud_mirror_provider: string | null
          cloud_mirror_synced_at: string | null
          created_at: string
          handover_category: string | null
          handover_folder_id: string | null
          id: string
          mime_type: string | null
          name: string
          organisation_id: string
          origin_id: string | null
          origin_kind: string | null
          project_id: string
          size_bytes: number | null
          source_file_id: string | null
          source_path: string | null
          source_provider: string | null
          source_revision_id: string | null
          storage_path: string
          synced_at: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          category?: string | null
          cloud_mirror_file_id?: string | null
          cloud_mirror_path?: string | null
          cloud_mirror_provider?: string | null
          cloud_mirror_synced_at?: string | null
          created_at?: string
          handover_category?: string | null
          handover_folder_id?: string | null
          id?: string
          mime_type?: string | null
          name: string
          organisation_id: string
          origin_id?: string | null
          origin_kind?: string | null
          project_id: string
          size_bytes?: number | null
          source_file_id?: string | null
          source_path?: string | null
          source_provider?: string | null
          source_revision_id?: string | null
          storage_path: string
          synced_at?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          category?: string | null
          cloud_mirror_file_id?: string | null
          cloud_mirror_path?: string | null
          cloud_mirror_provider?: string | null
          cloud_mirror_synced_at?: string | null
          created_at?: string
          handover_category?: string | null
          handover_folder_id?: string | null
          id?: string
          mime_type?: string | null
          name?: string
          organisation_id?: string
          origin_id?: string | null
          origin_kind?: string | null
          project_id?: string
          size_bytes?: number | null
          source_file_id?: string | null
          source_path?: string | null
          source_provider?: string | null
          source_revision_id?: string | null
          storage_path?: string
          synced_at?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_handover_folder_id_fkey"
            columns: ["handover_folder_id"]
            isOneToOne: false
            referencedRelation: "handover_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_plan_markups: {
        Row: {
          created_at: string
          created_by: string | null
          file_path: string
          floor_plan_id: string
          id: string
          name: string
          organisation_id: string
          project_id: string
          scene: Json
          source_revision_id: string | null
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          file_path: string
          floor_plan_id: string
          id?: string
          name: string
          organisation_id: string
          project_id: string
          scene: Json
          source_revision_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          file_path?: string
          floor_plan_id?: string
          id?: string
          name?: string
          organisation_id?: string
          project_id?: string
          scene?: Json
          source_revision_id?: string | null
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "floor_plan_markups_floor_plan_id_fkey"
            columns: ["floor_plan_id"]
            isOneToOne: false
            referencedRelation: "floor_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_plan_page_scales: {
        Row: {
          calibrated_at: string
          calibrated_by: string | null
          calibration_metres: number | null
          calibration_points: Json | null
          floor_plan_id: string
          organisation_id: string
          page_index: number
          pixels_per_meter: number
        }
        Insert: {
          calibrated_at?: string
          calibrated_by?: string | null
          calibration_metres?: number | null
          calibration_points?: Json | null
          floor_plan_id: string
          organisation_id: string
          page_index: number
          pixels_per_meter: number
        }
        Update: {
          calibrated_at?: string
          calibrated_by?: string | null
          calibration_metres?: number | null
          calibration_points?: Json | null
          floor_plan_id?: string
          organisation_id?: string
          page_index?: number
          pixels_per_meter?: number
        }
        Relationships: [
          {
            foreignKeyName: "floor_plan_page_scales_floor_plan_id_fkey"
            columns: ["floor_plan_id"]
            isOneToOne: false
            referencedRelation: "floor_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_plan_versions: {
        Row: {
          created_at: string
          file_path: string
          file_size_bytes: number | null
          floor_plan_id: string
          id: string
          organisation_id: string
          project_id: string
          source_modified_at: string | null
          source_revision_id: string
          synced_at: string
        }
        Insert: {
          created_at?: string
          file_path: string
          file_size_bytes?: number | null
          floor_plan_id: string
          id?: string
          organisation_id: string
          project_id: string
          source_modified_at?: string | null
          source_revision_id: string
          synced_at?: string
        }
        Update: {
          created_at?: string
          file_path?: string
          file_size_bytes?: number | null
          floor_plan_id?: string
          id?: string
          organisation_id?: string
          project_id?: string
          source_modified_at?: string | null
          source_revision_id?: string
          synced_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "floor_plan_versions_floor_plan_id_fkey"
            columns: ["floor_plan_id"]
            isOneToOne: false
            referencedRelation: "floor_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_plan_zones: {
        Row: {
          color: string | null
          created_at: string
          floor_plan_id: string
          id: string
          name: string
          organisation_id: string
          polygon: Json
        }
        Insert: {
          color?: string | null
          created_at?: string
          floor_plan_id: string
          id?: string
          name: string
          organisation_id: string
          polygon?: Json
        }
        Update: {
          color?: string | null
          created_at?: string
          floor_plan_id?: string
          id?: string
          name?: string
          organisation_id?: string
          polygon?: Json
        }
        Relationships: [
          {
            foreignKeyName: "floor_plan_zones_floor_plan_id_fkey"
            columns: ["floor_plan_id"]
            isOneToOne: false
            referencedRelation: "floor_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      floor_plans: {
        Row: {
          calibrated_at: string | null
          calibrated_by: string | null
          calibration_metres: number | null
          calibration_page_index: number | null
          calibration_points: Json | null
          created_at: string
          file_path: string
          file_size_bytes: number | null
          has_newer_version: boolean
          height_px: number | null
          id: string
          is_active: boolean
          latest_revision_id: string | null
          latest_synced_at: string | null
          level: string | null
          name: string
          organisation_id: string
          pixels_per_meter: number | null
          project_id: string
          scale: string | null
          source_file_id: string | null
          source_path: string | null
          source_provider: string | null
          source_revision_id: string | null
          synced_at: string | null
          updated_at: string
          uploaded_by: string
          width_px: number | null
        }
        Insert: {
          calibrated_at?: string | null
          calibrated_by?: string | null
          calibration_metres?: number | null
          calibration_page_index?: number | null
          calibration_points?: Json | null
          created_at?: string
          file_path: string
          file_size_bytes?: number | null
          has_newer_version?: boolean
          height_px?: number | null
          id?: string
          is_active?: boolean
          latest_revision_id?: string | null
          latest_synced_at?: string | null
          level?: string | null
          name: string
          organisation_id: string
          pixels_per_meter?: number | null
          project_id: string
          scale?: string | null
          source_file_id?: string | null
          source_path?: string | null
          source_provider?: string | null
          source_revision_id?: string | null
          synced_at?: string | null
          updated_at?: string
          uploaded_by: string
          width_px?: number | null
        }
        Update: {
          calibrated_at?: string | null
          calibrated_by?: string | null
          calibration_metres?: number | null
          calibration_page_index?: number | null
          calibration_points?: Json | null
          created_at?: string
          file_path?: string
          file_size_bytes?: number | null
          has_newer_version?: boolean
          height_px?: number | null
          id?: string
          is_active?: boolean
          latest_revision_id?: string | null
          latest_synced_at?: string | null
          level?: string | null
          name?: string
          organisation_id?: string
          pixels_per_meter?: number | null
          project_id?: string
          scale?: string | null
          source_file_id?: string | null
          source_path?: string | null
          source_provider?: string | null
          source_revision_id?: string | null
          synced_at?: string | null
          updated_at?: string
          uploaded_by?: string
          width_px?: number | null
        }
        Relationships: []
      }
      handover_folders: {
        Row: {
          category: string
          cloud_folder_id: string | null
          cloud_folder_path: string | null
          cloud_provider: string | null
          cloud_synced_at: string | null
          created_at: string
          created_by: string | null
          folder_path: string
          id: string
          name: string
          organisation_id: string
          parent_folder_id: string | null
          project_id: string
          updated_at: string
        }
        Insert: {
          category: string
          cloud_folder_id?: string | null
          cloud_folder_path?: string | null
          cloud_provider?: string | null
          cloud_synced_at?: string | null
          created_at?: string
          created_by?: string | null
          folder_path?: string
          id?: string
          name: string
          organisation_id: string
          parent_folder_id?: string | null
          project_id: string
          updated_at?: string
        }
        Update: {
          category?: string
          cloud_folder_id?: string | null
          cloud_folder_path?: string | null
          cloud_provider?: string | null
          cloud_synced_at?: string | null
          created_at?: string
          created_by?: string | null
          folder_path?: string
          id?: string
          name?: string
          organisation_id?: string
          parent_folder_id?: string | null
          project_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "handover_folders_parent_folder_id_fkey"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "handover_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      status_plan_shapes: {
        Row: {
          area_type: string | null
          created_at: string
          created_by: string | null
          detected_tag: string | null
          id: string
          node_id: string | null
          points: Json
          shape: string
          source: string
          status_plan_id: string
          updated_at: string
        }
        Insert: {
          area_type?: string | null
          created_at?: string
          /** Hand-patched optional: bound to auth.uid() by trigger (00245). */
          created_by?: string | null
          detected_tag?: string | null
          id?: string
          node_id?: string | null
          points: Json
          shape: string
          source?: string
          status_plan_id: string
          updated_at?: string
        }
        Update: {
          area_type?: string | null
          created_at?: string
          created_by?: string | null
          detected_tag?: string | null
          id?: string
          node_id?: string | null
          points?: Json
          shape?: string
          source?: string
          status_plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_plan_shapes_status_plan_id_fkey"
            columns: ["status_plan_id"]
            isOneToOne: false
            referencedRelation: "status_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      status_plans: {
        Row: {
          created_at: string
          created_by: string | null
          floor_plan_id: string
          id: string
          name: string
          organisation_id: string
          page_index: number
          project_id: string
          purpose: string
          source_file_path: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          /** Hand-patched optional: bound to auth.uid() by trigger (00245). */
          created_by?: string | null
          floor_plan_id: string
          id?: string
          name: string
          /** Hand-patched optional: bound from the drawing by trigger (00245). */
          organisation_id?: string
          page_index: number
          project_id: string
          purpose: string
          /** Hand-patched optional: stamped from the drawing by trigger (00245). */
          source_file_path?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          floor_plan_id?: string
          id?: string
          name?: string
          organisation_id?: string
          page_index?: number
          project_id?: string
          purpose?: string
          source_file_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "status_plans_floor_plan_id_fkey"
            columns: ["floor_plan_id"]
            isOneToOne: false
            referencedRelation: "floor_plans"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  billing: {
    Enums: {},
  },
  cable_schedule: {
    Enums: {},
  },
  field: {
    Enums: {},
  },
  inspections: {
    Enums: {},
  },
  marketplace: {
    Enums: {},
  },
  projects: {
    Enums: {},
  },
  public: {
    Enums: {
      diary_entry_type: [
        "progress",
        "safety",
        "quality",
        "delay",
        "weather",
        "workforce",
        "general",
      ],
    },
  },
  solar: {
    Enums: {},
  },
  structure: {
    Enums: {},
  },
  suppliers: {
    Enums: {},
  },
  tariffs: {
    Enums: {},
  },
  tenants: {
    Enums: {},
  },
} as const
