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
          next_billing_date: string | null
          organisation_id: string
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
          next_billing_date?: string | null
          organisation_id: string
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
          next_billing_date?: string | null
          organisation_id?: string
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
  compliance: {
    Tables: {
      coc_uploads: {
        Row: {
          created_at: string
          file_path: string
          file_size_bytes: number | null
          id: string
          organisation_id: string
          rejection_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          subsection_id: string
          updated_at: string
          uploaded_by: string
          version: number
        }
        Insert: {
          created_at?: string
          file_path: string
          file_size_bytes?: number | null
          id?: string
          organisation_id: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          subsection_id: string
          updated_at?: string
          uploaded_by: string
          version?: number
        }
        Update: {
          created_at?: string
          file_path?: string
          file_size_bytes?: number | null
          id?: string
          organisation_id?: string
          rejection_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          subsection_id?: string
          updated_at?: string
          uploaded_by?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "coc_uploads_subsection_id_fkey"
            columns: ["subsection_id"]
            isOneToOne: false
            referencedRelation: "subsections"
            referencedColumns: ["id"]
          },
        ]
      }
      project_sites: {
        Row: {
          created_at: string
          id: string
          project_id: string
          site_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          project_id: string
          site_id: string
        }
        Update: {
          created_at?: string
          id?: string
          project_id?: string
          site_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_sites_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
        ]
      }
      qr_codes: {
        Row: {
          code: string
          created_at: string
          id: string
          is_active: boolean
          label: string | null
          organisation_id: string
          site_id: string | null
          subsection_id: string | null
        }
        Insert: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          organisation_id: string
          site_id?: string | null
          subsection_id?: string | null
        }
        Update: {
          code?: string
          created_at?: string
          id?: string
          is_active?: boolean
          label?: string | null
          organisation_id?: string
          site_id?: string | null
          subsection_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "qr_codes_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qr_codes_subsection_id_fkey"
            columns: ["subsection_id"]
            isOneToOne: false
            referencedRelation: "subsections"
            referencedColumns: ["id"]
          },
        ]
      }
      sites: {
        Row: {
          address: string
          city: string | null
          created_at: string
          created_by: string
          erf_number: string | null
          id: string
          name: string
          organisation_id: string
          province: string | null
          site_type: string | null
          status: string
          updated_at: string
        }
        Insert: {
          address: string
          city?: string | null
          created_at?: string
          created_by: string
          erf_number?: string | null
          id?: string
          name: string
          organisation_id: string
          province?: string | null
          site_type?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          address?: string
          city?: string | null
          created_at?: string
          created_by?: string
          erf_number?: string | null
          id?: string
          name?: string
          organisation_id?: string
          province?: string | null
          site_type?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      subsections: {
        Row: {
          coc_status: string
          created_at: string
          description: string | null
          id: string
          name: string
          organisation_id: string
          sans_ref: string | null
          site_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          coc_status?: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          organisation_id: string
          sans_ref?: string | null
          site_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          coc_status?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organisation_id?: string
          sans_ref?: string | null
          site_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subsections_site_id_fkey"
            columns: ["site_id"]
            isOneToOne: false
            referencedRelation: "sites"
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
          account_name: string | null
          account_number: string
          bank_code: string
          bank_name: string | null
          created_at: string
          id: string
          is_active: boolean
          subaccount_code: string
          supplier_id: string
          supplier_org_id: string | null
          updated_at: string
        }
        Insert: {
          account_name?: string | null
          account_number: string
          bank_code: string
          bank_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          subaccount_code: string
          supplier_id: string
          supplier_org_id?: string | null
          updated_at?: string
        }
        Update: {
          account_name?: string | null
          account_number?: string
          bank_code?: string
          bank_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
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
          contractor_org_id: string
          created_at: string
          id: string
          order_id: string
          quality_rating: number | null
          rating: number
          supplier_id: string
        }
        Insert: {
          comment?: string | null
          contractor_org_id: string
          created_at?: string
          id?: string
          order_id: string
          quality_rating?: number | null
          rating: number
          supplier_id: string
        }
        Update: {
          comment?: string | null
          contractor_org_id?: string
          created_at?: string
          id?: string
          order_id?: string
          quality_rating?: number | null
          rating?: number
          supplier_id?: string
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
          po_number: string | null
          project_id: string
          quantity: number | null
          quoted_price: number | null
          required_by: string | null
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
          po_number?: string | null
          project_id: string
          quantity?: number | null
          quoted_price?: number | null
          required_by?: string | null
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
          po_number?: string | null
          project_id?: string
          quantity?: number | null
          quoted_price?: number | null
          required_by?: string | null
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
          city: string | null
          client_contact: string | null
          client_name: string | null
          contract_value: number | null
          created_at: string
          created_by: string
          currency: string
          description: string | null
          end_date: string | null
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
          city?: string | null
          client_contact?: string | null
          client_name?: string | null
          contract_value?: number | null
          created_at?: string
          created_by: string
          currency?: string
          description?: string | null
          end_date?: string | null
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
          city?: string | null
          client_contact?: string | null
          client_name?: string | null
          contract_value?: number | null
          created_at?: string
          created_by?: string
          currency?: string
          description?: string | null
          end_date?: string | null
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
      site_diary_entries: {
        Row: {
          created_at: string
          created_by: string
          delay_notes: string | null
          delays: string | null
          entry_date: string
          entry_type: string | null
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
          entry_type?: string | null
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
          entry_type?: string | null
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
      notifications: {
        Row: {
          action_url: string | null
          body: string | null
          created_at: string
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
          body?: string | null
          created_at?: string
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
          body?: string | null
          created_at?: string
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
      org_invites: {
        Row: {
          accepted_at: string | null
          created_at: string
          email: string
          expires_at: string
          id: string
          invited_by: string
          organisation_id: string
          role: string
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          invited_by: string
          organisation_id: string
          role?: string
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          invited_by?: string
          organisation_id?: string
          role?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "org_invites_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "org_invites_organisation_id_fkey"
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
          platform: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          platform: string
          token: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
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
          {
            foreignKeyName: "rfi_annotations_source_floor_plan_id_fkey"
            columns: ["source_floor_plan_id"]
            isOneToOne: false
            referencedRelation: "floor_plans"
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
      get_user_org_ids: { Args: never; Returns: string[] }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
          created_at: string
          file_path: string
          file_size_bytes: number | null
          height_px: number | null
          id: string
          is_active: boolean
          level: string | null
          name: string
          organisation_id: string
          project_id: string
          scale: string | null
          updated_at: string
          uploaded_by: string
          width_px: number | null
        }
        Insert: {
          created_at?: string
          file_path: string
          file_size_bytes?: number | null
          height_px?: number | null
          id?: string
          is_active?: boolean
          level?: string | null
          name: string
          organisation_id: string
          project_id: string
          scale?: string | null
          updated_at?: string
          uploaded_by: string
          width_px?: number | null
        }
        Update: {
          created_at?: string
          file_path?: string
          file_size_bytes?: number | null
          height_px?: number | null
          id?: string
          is_active?: boolean
          level?: string | null
          name?: string
          organisation_id?: string
          project_id?: string
          scale?: string | null
          updated_at?: string
          uploaded_by?: string
          width_px?: number | null
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
  compliance: {
    Enums: {},
  },
  field: {
    Enums: {},
  },
  marketplace: {
    Enums: {},
  },
  projects: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
  suppliers: {
    Enums: {},
  },
  tenants: {
    Enums: {},
  },
} as const
