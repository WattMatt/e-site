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
      boards: {
        Row: {
          area_m2: number | null
          breaker_rating_a: number | null
          code: string
          created_at: string
          id: string
          kind: string
          notes: string | null
          organisation_id: string
          parent_board_id: string | null
          pole_config: string | null
          revision_id: string
          section: string | null
          short_code: string | null
          tenant_name: string | null
          updated_at: string
        }
        Insert: {
          area_m2?: number | null
          breaker_rating_a?: number | null
          code: string
          created_at?: string
          id?: string
          kind: string
          notes?: string | null
          organisation_id: string
          parent_board_id?: string | null
          pole_config?: string | null
          revision_id: string
          section?: string | null
          short_code?: string | null
          tenant_name?: string | null
          updated_at?: string
        }
        Update: {
          area_m2?: number | null
          breaker_rating_a?: number | null
          code?: string
          created_at?: string
          id?: string
          kind?: string
          notes?: string | null
          organisation_id?: string
          parent_board_id?: string | null
          pole_config?: string | null
          revision_id?: string
          section?: string | null
          short_code?: string | null
          tenant_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "boards_parent_board_id_fkey"
            columns: ["parent_board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "boards_revision_id_fkey"
            columns: ["revision_id"]
            isOneToOne: false
            referencedRelation: "revisions"
            referencedColumns: ["id"]
          },
        ]
      }
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
      rate_library: {
        Row: {
          conductor: string
          id: string
          install_rate_per_m: number
          notes: string | null
          organisation_id: string
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
          from_board_id: string | null
          from_node_id: string | null
          from_source_id: string | null
          id: string
          notes: string | null
          organisation_id: string
          revision_id: string
          section: string | null
          to_board_id: string
          to_node_id: string | null
          updated_at: string
          voltage_v: number
        }
        Insert: {
          created_at?: string
          design_load_a: number
          from_board_id?: string | null
          from_node_id?: string | null
          from_source_id?: string | null
          id?: string
          notes?: string | null
          organisation_id: string
          revision_id: string
          section?: string | null
          to_board_id: string
          to_node_id?: string | null
          updated_at?: string
          voltage_v: number
        }
        Update: {
          created_at?: string
          design_load_a?: number
          from_board_id?: string | null
          from_node_id?: string | null
          from_source_id?: string | null
          id?: string
          notes?: string | null
          organisation_id?: string
          revision_id?: string
          section?: string | null
          to_board_id?: string
          to_node_id?: string | null
          updated_at?: string
          voltage_v?: number
        }
        Relationships: [
          {
            foreignKeyName: "supplies_from_board_id_fkey"
            columns: ["from_board_id"]
            isOneToOne: false
            referencedRelation: "boards"
            referencedColumns: ["id"]
          },
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
          {
            foreignKeyName: "supplies_to_board_id_fkey"
            columns: ["to_board_id"]
            isOneToOne: false
            referencedRelation: "boards"
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
      [_ in never]: never
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
        }
        Relationships: [
          {
            foreignKeyName: "snag_photos_snag_id_fkey"
            columns: ["snag_id"]
            isOneToOne: false
            referencedRelation: "snags"
            referencedColumns: ["id"]
          },
        ]
      }
      snags: {
        Row: {
          assigned_to: string | null
          category: string
          created_at: string
          description: string | null
          floor_plan_pin: Json | null
          id: string
          location: string | null
          organisation_id: string
          priority: string
          project_id: string
          raised_by: string
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
          created_at?: string
          description?: string | null
          floor_plan_pin?: Json | null
          id?: string
          location?: string | null
          organisation_id: string
          priority?: string
          project_id: string
          raised_by: string
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
          created_at?: string
          description?: string | null
          floor_plan_pin?: Json | null
          id?: string
          location?: string | null
          organisation_id?: string
          priority?: string
          project_id?: string
          raised_by?: string
          resolved_at?: string | null
          signature_path?: string | null
          signed_off_at?: string | null
          signed_off_by?: string | null
          status?: string
          title?: string
          updated_at?: string
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
          certificate_id: string
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
          certificate_id: string
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
          certificate_id?: string
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
          uploaded_by: string
          width_px?: number | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          field_id?: string
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
          id: string
          inspection_id: string
          registration_number: string | null
          role: string
          signatory_name: string
          signatory_title: string | null
          signed_at: string
          signed_by: string
          storage_path: string
        }
        Insert: {
          id?: string
          inspection_id: string
          registration_number?: string | null
          role: string
          signatory_name: string
          signatory_title?: string | null
          signed_at?: string
          signed_by: string
          storage_path: string
        }
        Update: {
          id?: string
          inspection_id?: string
          registration_number?: string | null
          role?: string
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
          created_at: string
          created_by: string | null
          deliverable_type: string
          id: string
          is_active: boolean
          name: string
          node_subtypes: string[] | null
          organisation_id: string
          sans_reference: string | null
          schema_json: Json
          template_id: string
          updated_at: string
          version: string
        }
        Insert: {
          applies_to_node_types: string[]
          created_at?: string
          created_by?: string | null
          deliverable_type: string
          id?: string
          is_active?: boolean
          name: string
          node_subtypes?: string[] | null
          organisation_id: string
          sans_reference?: string | null
          schema_json: Json
          template_id: string
          updated_at?: string
          version: string
        }
        Update: {
          applies_to_node_types?: string[]
          created_at?: string
          created_by?: string | null
          deliverable_type?: string
          id?: string
          is_active?: boolean
          name?: string
          node_subtypes?: string[] | null
          organisation_id?: string
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
      refresh_supplier_rating_summary: { Args: never; Returns: undefined }
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
      engineer_equipment_schedule: {
        Row: {
          added_by: string | null
          created_at: string
          currency: string
          description: string
          estimated_unit_cost: number | null
          id: string
          instructions: string | null
          item_code: string | null
          organisation_id: string
          project_id: string
          quantity: number
          shop_drawing_required: boolean
          specification: string | null
          status: string
          unit: string | null
          updated_at: string
        }
        Insert: {
          added_by?: string | null
          created_at?: string
          currency?: string
          description: string
          estimated_unit_cost?: number | null
          id?: string
          instructions?: string | null
          item_code?: string | null
          organisation_id: string
          project_id: string
          quantity: number
          shop_drawing_required?: boolean
          specification?: string | null
          status?: string
          unit?: string | null
          updated_at?: string
        }
        Update: {
          added_by?: string | null
          created_at?: string
          currency?: string
          description?: string
          estimated_unit_cost?: number | null
          id?: string
          instructions?: string | null
          item_code?: string | null
          organisation_id?: string
          project_id?: string
          quantity?: number
          shop_drawing_required?: boolean
          specification?: string | null
          status?: string
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "engineer_equipment_schedule_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      goods_received_notes: {
        Row: {
          condition: string
          created_at: string
          delivered_at: string
          id: string
          notes: string | null
          organisation_id: string
          photo_paths: string[]
          procurement_item_id: string
          project_id: string
          quantity_received: number
          received_by: string | null
          signed_pod_path: string | null
        }
        Insert: {
          condition?: string
          created_at?: string
          delivered_at?: string
          id?: string
          notes?: string | null
          organisation_id: string
          photo_paths?: string[]
          procurement_item_id: string
          project_id: string
          quantity_received: number
          received_by?: string | null
          signed_pod_path?: string | null
        }
        Update: {
          condition?: string
          created_at?: string
          delivered_at?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          photo_paths?: string[]
          procurement_item_id?: string
          project_id?: string
          quantity_received?: number
          received_by?: string | null
          signed_pod_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "goods_received_notes_procurement_item_id_fkey"
            columns: ["procurement_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "goods_received_notes_project_id_fkey"
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
      procurement_items: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          delivery_date: string | null
          description: string
          id: string
          notes: string | null
          organisation_id: string
          photo_paths: string[]
          po_number: string | null
          project_id: string
          quantity: number | null
          quoted_price: number | null
          required_by: string | null
          schedule_item_id: string | null
          selected_quote_id: string | null
          status: string
          supplier_id: string | null
          unit: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          delivery_date?: string | null
          description: string
          id?: string
          notes?: string | null
          organisation_id: string
          photo_paths?: string[]
          po_number?: string | null
          project_id: string
          quantity?: number | null
          quoted_price?: number | null
          required_by?: string | null
          schedule_item_id?: string | null
          selected_quote_id?: string | null
          status?: string
          supplier_id?: string | null
          unit?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          delivery_date?: string | null
          description?: string
          id?: string
          notes?: string | null
          organisation_id?: string
          photo_paths?: string[]
          po_number?: string | null
          project_id?: string
          quantity?: number | null
          quoted_price?: number | null
          required_by?: string | null
          schedule_item_id?: string | null
          selected_quote_id?: string | null
          status?: string
          supplier_id?: string | null
          unit?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "procurement_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_items_schedule_item_id_fkey"
            columns: ["schedule_item_id"]
            isOneToOne: false
            referencedRelation: "engineer_equipment_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "procurement_items_selected_quote_id_fkey"
            columns: ["selected_quote_id"]
            isOneToOne: false
            referencedRelation: "procurement_quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      procurement_quotes: {
        Row: {
          created_at: string
          currency: string
          file_mime: string | null
          file_path: string | null
          file_size_bytes: number | null
          id: string
          is_selected: boolean
          lead_time_days: number | null
          notes: string | null
          organisation_id: string
          procurement_item_id: string
          quote_reference: string | null
          quoted_price: number
          received_at: string
          supplier_id: string | null
          supplier_name: string | null
          uploaded_by: string | null
          valid_until: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          file_mime?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          is_selected?: boolean
          lead_time_days?: number | null
          notes?: string | null
          organisation_id: string
          procurement_item_id: string
          quote_reference?: string | null
          quoted_price: number
          received_at?: string
          supplier_id?: string | null
          supplier_name?: string | null
          uploaded_by?: string | null
          valid_until?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          file_mime?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          is_selected?: boolean
          lead_time_days?: number | null
          notes?: string | null
          organisation_id?: string
          procurement_item_id?: string
          quote_reference?: string | null
          quoted_price?: number
          received_at?: string
          supplier_id?: string | null
          supplier_name?: string | null
          uploaded_by?: string | null
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procurement_quotes_procurement_item_id_fkey"
            columns: ["procurement_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_items"
            referencedColumns: ["id"]
          },
        ]
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
      projects: {
        Row: {
          address: string | null
          budget_amount: number | null
          budget_currency: string
          city: string | null
          client_contact: string | null
          client_name: string | null
          cloud_storage_connection_id: string | null
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
          organisation_id: string
          province: string | null
          site_manager_id: string | null
          start_date: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          budget_amount?: number | null
          budget_currency?: string
          city?: string | null
          client_contact?: string | null
          client_name?: string | null
          cloud_storage_connection_id?: string | null
          cloud_storage_folder_id?: string | null
          cloud_storage_folder_path?: string | null
          cloud_storage_last_sync_at?: string | null
          code: string
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
          organisation_id: string
          province?: string | null
          site_manager_id?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          budget_amount?: number | null
          budget_currency?: string
          city?: string | null
          client_contact?: string | null
          client_name?: string | null
          cloud_storage_connection_id?: string | null
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
          organisation_id?: string
          province?: string | null
          site_manager_id?: string | null
          start_date?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
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
      shop_drawing_approvals: {
        Row: {
          approver_user_id: string
          comments: string | null
          created_at: string
          decided_at: string
          decision: string
          id: string
          shop_drawing_id: string
        }
        Insert: {
          approver_user_id: string
          comments?: string | null
          created_at?: string
          decided_at?: string
          decision: string
          id?: string
          shop_drawing_id: string
        }
        Update: {
          approver_user_id?: string
          comments?: string | null
          created_at?: string
          decided_at?: string
          decision?: string
          id?: string
          shop_drawing_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_drawing_approvals_shop_drawing_id_fkey"
            columns: ["shop_drawing_id"]
            isOneToOne: false
            referencedRelation: "shop_drawings"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_drawings: {
        Row: {
          created_at: string
          file_mime: string | null
          file_path: string
          file_size_bytes: number | null
          id: string
          notes: string | null
          organisation_id: string
          procurement_item_id: string
          project_id: string
          revision: number
          status: string
          submitted_at: string
          submitted_by: string | null
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          file_mime?: string | null
          file_path: string
          file_size_bytes?: number | null
          id?: string
          notes?: string | null
          organisation_id: string
          procurement_item_id: string
          project_id: string
          revision?: number
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          file_mime?: string | null
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          notes?: string | null
          organisation_id?: string
          procurement_item_id?: string
          project_id?: string
          revision?: number
          status?: string
          submitted_at?: string
          submitted_by?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "shop_drawings_procurement_item_id_fkey"
            columns: ["procurement_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shop_drawings_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
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
      supplier_invoices: {
        Row: {
          amount: number
          created_at: string
          currency: string
          file_mime: string | null
          file_path: string | null
          file_size_bytes: number | null
          id: string
          invoice_number: string
          notes: string | null
          organisation_id: string
          paid_at: string | null
          payment_reference: string | null
          procurement_item_id: string
          received_by: string | null
          status: string
          supplier_invoice_date: string
          updated_at: string
          vat_amount: number | null
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          file_mime?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          invoice_number: string
          notes?: string | null
          organisation_id: string
          paid_at?: string | null
          payment_reference?: string | null
          procurement_item_id: string
          received_by?: string | null
          status?: string
          supplier_invoice_date: string
          updated_at?: string
          vat_amount?: number | null
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          file_mime?: string | null
          file_path?: string | null
          file_size_bytes?: number | null
          id?: string
          invoice_number?: string
          notes?: string | null
          organisation_id?: string
          paid_at?: string | null
          payment_reference?: string | null
          procurement_item_id?: string
          received_by?: string | null
          status?: string
          supplier_invoice_date?: string
          updated_at?: string
          vat_amount?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "supplier_invoices_procurement_item_id_fkey"
            columns: ["procurement_item_id"]
            isOneToOne: false
            referencedRelation: "procurement_items"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      suggest_code: { Args: { _name: string }; Returns: string }
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
      email_sequence_events: {
        Row: {
          clicked_at: string | null
          id: string
          metadata: Json
          opened_at: string | null
          organisation_id: string | null
          resend_message_id: string | null
          sent_at: string
          sequence_name: string
          step_name: string
          subject: string
          to_email: string
          user_id: string
        }
        Insert: {
          clicked_at?: string | null
          id?: string
          metadata?: Json
          opened_at?: string | null
          organisation_id?: string | null
          resend_message_id?: string | null
          sent_at?: string
          sequence_name: string
          step_name: string
          subject: string
          to_email: string
          user_id: string
        }
        Update: {
          clicked_at?: string | null
          id?: string
          metadata?: Json
          opened_at?: string | null
          organisation_id?: string | null
          resend_message_id?: string | null
          sent_at?: string
          sequence_name?: string
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
          logo_url: string | null
          name: string
          paystack_customer_id: string | null
          phone: string | null
          province: string | null
          registration_no: string | null
          registration_number: string | null
          settings: Json
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
          logo_url?: string | null
          name: string
          paystack_customer_id?: string | null
          phone?: string | null
          province?: string | null
          registration_no?: string | null
          registration_number?: string | null
          settings?: Json
          slug: string
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
          logo_url?: string | null
          name?: string
          paystack_customer_id?: string | null
          phone?: string | null
          province?: string | null
          registration_no?: string | null
          registration_number?: string | null
          settings?: Json
          slug?: string
          storage_used_bytes?: number
          subscription_tier?: string
          type?: string
          updated_at?: string
          vat_number?: string | null
          website?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string
          id: string
          marketing_emails_opted_out: boolean
          notification_preferences: Json
          phone: string | null
          popia_consent_at: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name: string
          id: string
          marketing_emails_opted_out?: boolean
          notification_preferences?: Json
          phone?: string | null
          popia_consent_at?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string
          id?: string
          marketing_emails_opted_out?: boolean
          notification_preferences?: Json
          phone?: string | null
          popia_consent_at?: string | null
          updated_at?: string
        }
        Relationships: []
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
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      custom_jwt_claims: { Args: { event: Json }; Returns: Json }
      get_user_org_ids: { Args: never; Returns: string[] }
      get_user_org_ids_bypass: { Args: never; Returns: string[] }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      user_has_project_access: {
        Args: { _project_id: string }
        Returns: boolean
      }
      user_is_client_viewer: { Args: { org_id: string }; Returns: boolean }
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
  structure: {
    Tables: {
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
          decommission_reason: string | null
          id: string
          kind: string
          name: string | null
          notes: string | null
          organisation_id: string
          pole_config: string | null
          project_id: string
          rating_kva: number | null
          section: string | null
          shop_area_m2: number | null
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
          decommission_reason?: string | null
          id?: string
          kind: string
          name?: string | null
          notes?: string | null
          organisation_id: string
          pole_config?: string | null
          project_id: string
          rating_kva?: number | null
          section?: string | null
          shop_area_m2?: number | null
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
          decommission_reason?: string | null
          id?: string
          kind?: string
          name?: string | null
          notes?: string | null
          organisation_id?: string
          pole_config?: string | null
          project_id?: string
          rating_kva?: number | null
          section?: string | null
          shop_area_m2?: number | null
          shop_name?: string | null
          shop_number?: string | null
          short_code?: string | null
          status?: string
          updated_at?: string
          voltage_v?: number | null
        }
        Relationships: []
      }
      scope_item_types: {
        Row: {
          created_at: string
          id: string
          key: string
          label: string
          organisation_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          label: string
          organisation_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
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
          created_at: string
          id: string
          layout_drawing_path: string | null
          layout_issued_at: string | null
          layout_status: string
          node_id: string
          scope_document_path: string | null
          scope_status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          layout_drawing_path?: string | null
          layout_issued_at?: string | null
          layout_status?: string
          node_id: string
          scope_document_path?: string | null
          scope_status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          layout_drawing_path?: string | null
          layout_issued_at?: string | null
          layout_status?: string
          node_id?: string
          scope_document_path?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
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
  tenants: {
    Tables: {
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
          created_at: string
          file_path: string
          file_size_bytes: number | null
          height_px: number | null
          id: string
          is_active: boolean
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
          created_at?: string
          file_path: string
          file_size_bytes?: number | null
          height_px?: number | null
          id?: string
          is_active?: boolean
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
          created_at?: string
          file_path?: string
          file_size_bytes?: number | null
          height_px?: number | null
          id?: string
          is_active?: boolean
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
  structure: {
    Enums: {},
  },
  suppliers: {
    Enums: {},
  },
  tenants: {
    Enums: {},
  },
} as const
