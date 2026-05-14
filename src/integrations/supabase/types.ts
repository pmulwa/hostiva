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
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      acct_bank_charges: {
        Row: {
          amount: number
          booking_id: string | null
          charge_date: string
          charge_type: string
          created_at: string
          created_by: string
          currency: string
          description: string
          host_id: string
          id: string
          journal_entry_id: string | null
          reference: string | null
          status: string
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          amount: number
          booking_id?: string | null
          charge_date?: string
          charge_type: string
          created_at?: string
          created_by: string
          currency?: string
          description: string
          host_id: string
          id?: string
          journal_entry_id?: string | null
          reference?: string | null
          status?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          booking_id?: string | null
          charge_date?: string
          charge_type?: string
          created_at?: string
          created_by?: string
          currency?: string
          description?: string
          host_id?: string
          id?: string
          journal_entry_id?: string | null
          reference?: string | null
          status?: string
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: []
      }
      acct_chart_of_accounts: {
        Row: {
          code: string
          created_at: string
          host_id: string
          id: string
          is_active: boolean
          is_system: boolean
          name: string
          parent_id: string | null
          type: Database["public"]["Enums"]["acct_account_type"]
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          host_id: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name: string
          parent_id?: string | null
          type: Database["public"]["Enums"]["acct_account_type"]
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          host_id?: string
          id?: string
          is_active?: boolean
          is_system?: boolean
          name?: string
          parent_id?: string | null
          type?: Database["public"]["Enums"]["acct_account_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acct_chart_of_accounts_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "acct_chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      acct_expense_categories: {
        Row: {
          created_at: string
          default_account_id: string | null
          host_id: string
          id: string
          is_cogs: boolean
          name: string
        }
        Insert: {
          created_at?: string
          default_account_id?: string | null
          host_id: string
          id?: string
          is_cogs?: boolean
          name: string
        }
        Update: {
          created_at?: string
          default_account_id?: string | null
          host_id?: string
          id?: string
          is_cogs?: boolean
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "acct_expense_categories_default_account_id_fkey"
            columns: ["default_account_id"]
            isOneToOne: false
            referencedRelation: "acct_chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      acct_expenses: {
        Row: {
          allocations: Json
          amount: number
          base_amount: number | null
          category_id: string | null
          clearing_entry_id: string | null
          created_at: string
          currency: string
          description: string
          expense_date: string
          fx_rate: number
          host_id: string
          id: string
          is_capitalized: boolean
          is_recurring: boolean
          is_shared: boolean
          journal_entry_id: string | null
          paid_date: string | null
          payment_method: string | null
          payment_reference: string | null
          payment_status: string
          property_id: string | null
          receipt_url: string | null
          txn_currency: string
          updated_at: string
          vendor: string | null
        }
        Insert: {
          allocations?: Json
          amount: number
          base_amount?: number | null
          category_id?: string | null
          clearing_entry_id?: string | null
          created_at?: string
          currency?: string
          description: string
          expense_date?: string
          fx_rate?: number
          host_id: string
          id?: string
          is_capitalized?: boolean
          is_recurring?: boolean
          is_shared?: boolean
          journal_entry_id?: string | null
          paid_date?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string
          property_id?: string | null
          receipt_url?: string | null
          txn_currency?: string
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          allocations?: Json
          amount?: number
          base_amount?: number | null
          category_id?: string | null
          clearing_entry_id?: string | null
          created_at?: string
          currency?: string
          description?: string
          expense_date?: string
          fx_rate?: number
          host_id?: string
          id?: string
          is_capitalized?: boolean
          is_recurring?: boolean
          is_shared?: boolean
          journal_entry_id?: string | null
          paid_date?: string | null
          payment_method?: string | null
          payment_reference?: string | null
          payment_status?: string
          property_id?: string | null
          receipt_url?: string | null
          txn_currency?: string
          updated_at?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acct_expenses_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "acct_expense_categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acct_expenses_clearing_entry_id_fkey"
            columns: ["clearing_entry_id"]
            isOneToOne: false
            referencedRelation: "acct_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acct_expenses_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "acct_journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      acct_external_bookings: {
        Row: {
          base_amount: number | null
          check_in_date: string
          check_out_date: string
          cleaning_fee: number
          clearing_entry_id: string | null
          commission_amount: number
          created_at: string
          extra_fees: number
          fx_rate: number
          gross_revenue: number
          guest_name: string | null
          host_id: string
          id: string
          journal_entry_id: string | null
          net_payout: number
          notes: string | null
          num_nights: number
          payment_method: string | null
          payment_received_date: string | null
          payment_reference: string | null
          payment_status: string
          platform_id: string | null
          processing_fees: number
          property_id: string | null
          status: string
          taxes_collected: number
          txn_currency: string
          updated_at: string
        }
        Insert: {
          base_amount?: number | null
          check_in_date: string
          check_out_date: string
          cleaning_fee?: number
          clearing_entry_id?: string | null
          commission_amount?: number
          created_at?: string
          extra_fees?: number
          fx_rate?: number
          gross_revenue?: number
          guest_name?: string | null
          host_id: string
          id?: string
          journal_entry_id?: string | null
          net_payout?: number
          notes?: string | null
          num_nights?: number
          payment_method?: string | null
          payment_received_date?: string | null
          payment_reference?: string | null
          payment_status?: string
          platform_id?: string | null
          processing_fees?: number
          property_id?: string | null
          status?: string
          taxes_collected?: number
          txn_currency?: string
          updated_at?: string
        }
        Update: {
          base_amount?: number | null
          check_in_date?: string
          check_out_date?: string
          cleaning_fee?: number
          clearing_entry_id?: string | null
          commission_amount?: number
          created_at?: string
          extra_fees?: number
          fx_rate?: number
          gross_revenue?: number
          guest_name?: string | null
          host_id?: string
          id?: string
          journal_entry_id?: string | null
          net_payout?: number
          notes?: string | null
          num_nights?: number
          payment_method?: string | null
          payment_received_date?: string | null
          payment_reference?: string | null
          payment_status?: string
          platform_id?: string | null
          processing_fees?: number
          property_id?: string | null
          status?: string
          taxes_collected?: number
          txn_currency?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "acct_external_bookings_clearing_entry_id_fkey"
            columns: ["clearing_entry_id"]
            isOneToOne: false
            referencedRelation: "acct_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acct_external_bookings_journal_entry_id_fkey"
            columns: ["journal_entry_id"]
            isOneToOne: false
            referencedRelation: "acct_journal_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acct_external_bookings_platform_id_fkey"
            columns: ["platform_id"]
            isOneToOne: false
            referencedRelation: "acct_platforms"
            referencedColumns: ["id"]
          },
        ]
      }
      acct_fixed_assets: {
        Row: {
          accumulated_depreciation: number
          asset_account_id: string | null
          cost: number
          created_at: string
          description: string
          disposal_date: string | null
          host_id: string
          id: string
          last_depreciation_date: string | null
          property_id: string | null
          purchase_date: string
          updated_at: string
          useful_life_years: number
        }
        Insert: {
          accumulated_depreciation?: number
          asset_account_id?: string | null
          cost: number
          created_at?: string
          description: string
          disposal_date?: string | null
          host_id: string
          id?: string
          last_depreciation_date?: string | null
          property_id?: string | null
          purchase_date: string
          updated_at?: string
          useful_life_years?: number
        }
        Update: {
          accumulated_depreciation?: number
          asset_account_id?: string | null
          cost?: number
          created_at?: string
          description?: string
          disposal_date?: string | null
          host_id?: string
          id?: string
          last_depreciation_date?: string | null
          property_id?: string | null
          purchase_date?: string
          updated_at?: string
          useful_life_years?: number
        }
        Relationships: [
          {
            foreignKeyName: "acct_fixed_assets_asset_account_id_fkey"
            columns: ["asset_account_id"]
            isOneToOne: false
            referencedRelation: "acct_chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      acct_journal_entries: {
        Row: {
          created_at: string
          created_by: string | null
          description: string
          entry_date: string
          host_id: string
          id: string
          posted: boolean
          reference: string | null
          source_id: string | null
          source_type: Database["public"]["Enums"]["acct_journal_source"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description: string
          entry_date?: string
          host_id: string
          id?: string
          posted?: boolean
          reference?: string | null
          source_id?: string | null
          source_type?: Database["public"]["Enums"]["acct_journal_source"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string
          entry_date?: string
          host_id?: string
          id?: string
          posted?: boolean
          reference?: string | null
          source_id?: string | null
          source_type?: Database["public"]["Enums"]["acct_journal_source"]
          updated_at?: string
        }
        Relationships: []
      }
      acct_journal_lines: {
        Row: {
          account_id: string
          created_at: string
          credit: number
          debit: number
          entry_id: string
          id: string
          memo: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          credit?: number
          debit?: number
          entry_id: string
          id?: string
          memo?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          credit?: number
          debit?: number
          entry_id?: string
          id?: string
          memo?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acct_journal_lines_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "acct_chart_of_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "acct_journal_lines_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "acct_journal_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      acct_opening_balances: {
        Row: {
          account_id: string
          created_at: string
          credit: number
          debit: number
          go_live_date: string
          host_id: string
          id: string
          locked: boolean
          notes: string | null
        }
        Insert: {
          account_id: string
          created_at?: string
          credit?: number
          debit?: number
          go_live_date: string
          host_id: string
          id?: string
          locked?: boolean
          notes?: string | null
        }
        Update: {
          account_id?: string
          created_at?: string
          credit?: number
          debit?: number
          go_live_date?: string
          host_id?: string
          id?: string
          locked?: boolean
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "acct_opening_balances_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "acct_chart_of_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      acct_pin_attempts: {
        Row: {
          failed_count: number
          first_failed_at: string | null
          host_id: string
          last_failed_at: string | null
          locked_until: string | null
          updated_at: string
        }
        Insert: {
          failed_count?: number
          first_failed_at?: string | null
          host_id: string
          last_failed_at?: string | null
          locked_until?: string | null
          updated_at?: string
        }
        Update: {
          failed_count?: number
          first_failed_at?: string | null
          host_id?: string
          last_failed_at?: string | null
          locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      acct_platforms: {
        Row: {
          commission_percent: number
          created_at: string
          currency: string
          host_id: string
          id: string
          is_active: boolean
          name: string
          payout_lag_days: number
        }
        Insert: {
          commission_percent?: number
          created_at?: string
          currency?: string
          host_id: string
          id?: string
          is_active?: boolean
          name: string
          payout_lag_days?: number
        }
        Update: {
          commission_percent?: number
          created_at?: string
          currency?: string
          host_id?: string
          id?: string
          is_active?: boolean
          name?: string
          payout_lag_days?: number
        }
        Relationships: []
      }
      acct_reconciliations: {
        Row: {
          booking_id: string
          created_at: string
          host_id: string
          id: string
          is_balanced: boolean
          notes: string | null
          reconciled_at: string
          reconciled_by: string
          reversal_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          total_credits: number
          total_debits: number
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          host_id: string
          id?: string
          is_balanced: boolean
          notes?: string | null
          reconciled_at?: string
          reconciled_by: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          total_credits: number
          total_debits: number
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          host_id?: string
          id?: string
          is_balanced?: boolean
          notes?: string | null
          reconciled_at?: string
          reconciled_by?: string
          reversal_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          total_credits?: number
          total_debits?: number
          updated_at?: string
        }
        Relationships: []
      }
      acct_settings: {
        Row: {
          account_pin_hash: string | null
          account_pin_set_at: string | null
          accounting_method: Database["public"]["Enums"]["acct_method"]
          base_currency: string
          created_at: string
          entry_date_basis: string
          go_live_date: string
          host_id: string
          id: string
          period_locked_through: string | null
          seeded: boolean
          updated_at: string
        }
        Insert: {
          account_pin_hash?: string | null
          account_pin_set_at?: string | null
          accounting_method?: Database["public"]["Enums"]["acct_method"]
          base_currency?: string
          created_at?: string
          entry_date_basis?: string
          go_live_date?: string
          host_id: string
          id?: string
          period_locked_through?: string | null
          seeded?: boolean
          updated_at?: string
        }
        Update: {
          account_pin_hash?: string | null
          account_pin_set_at?: string | null
          accounting_method?: Database["public"]["Enums"]["acct_method"]
          base_currency?: string
          created_at?: string
          entry_date_basis?: string
          go_live_date?: string
          host_id?: string
          id?: string
          period_locked_through?: string | null
          seeded?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      acct_sharing_presets: {
        Row: {
          allocations: Json
          created_at: string
          host_id: string
          id: string
          name: string
          updated_at: string
        }
        Insert: {
          allocations?: Json
          created_at?: string
          host_id: string
          id?: string
          name: string
          updated_at?: string
        }
        Update: {
          allocations?: Json
          created_at?: string
          host_id?: string
          id?: string
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      admin_user_notes: {
        Row: {
          author_id: string
          created_at: string
          id: string
          note: string
          target_user_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          created_at?: string
          id?: string
          note: string
          target_user_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          created_at?: string
          id?: string
          note?: string
          target_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      amenities: {
        Row: {
          category: string | null
          created_at: string
          icon: string | null
          id: string
          name: string
        }
        Insert: {
          category?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name: string
        }
        Update: {
          category?: string | null
          created_at?: string
          icon?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      anti_circumvention_strikes: {
        Row: {
          action_taken: string
          appeal_notes: string | null
          appealed: boolean
          created_at: string
          detected_content: string
          id: string
          message_id: string | null
          offence_number: number
          reviewed_by: string | null
          user_id: string
          violation_type: string
        }
        Insert: {
          action_taken: string
          appeal_notes?: string | null
          appealed?: boolean
          created_at?: string
          detected_content: string
          id?: string
          message_id?: string | null
          offence_number?: number
          reviewed_by?: string | null
          user_id: string
          violation_type: string
        }
        Update: {
          action_taken?: string
          appeal_notes?: string | null
          appealed?: boolean
          created_at?: string
          detected_content?: string
          id?: string
          message_id?: string | null
          offence_number?: number
          reviewed_by?: string | null
          user_id?: string
          violation_type?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          details: Json | null
          entity_id: string | null
          entity_type: string
          id: string
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          details?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
        }
        Relationships: []
      }
      booking_check_in_details: {
        Row: {
          access_code: string | null
          assisted_notes: string | null
          booking_id: string
          created_at: string
          guest_confirmed_at: string | null
          guest_id: string
          host_id: string
          id: string
          is_assisted: boolean
          key_location: string | null
          parking_info: string | null
          shared_at: string | null
          special_instructions: string | null
          updated_at: string
          wifi_name: string | null
          wifi_password: string | null
        }
        Insert: {
          access_code?: string | null
          assisted_notes?: string | null
          booking_id: string
          created_at?: string
          guest_confirmed_at?: string | null
          guest_id: string
          host_id: string
          id?: string
          is_assisted?: boolean
          key_location?: string | null
          parking_info?: string | null
          shared_at?: string | null
          special_instructions?: string | null
          updated_at?: string
          wifi_name?: string | null
          wifi_password?: string | null
        }
        Update: {
          access_code?: string | null
          assisted_notes?: string | null
          booking_id?: string
          created_at?: string
          guest_confirmed_at?: string | null
          guest_id?: string
          host_id?: string
          id?: string
          is_assisted?: boolean
          key_location?: string | null
          parking_info?: string | null
          shared_at?: string | null
          special_instructions?: string | null
          updated_at?: string
          wifi_name?: string | null
          wifi_password?: string | null
        }
        Relationships: []
      }
      booking_issues: {
        Row: {
          booking_id: string
          category: string
          created_at: string
          description: string
          guest_id: string
          host_id: string
          host_response: string | null
          id: string
          photos: string[]
          property_id: string
          resolved_at: string | null
          severity: string
          status: string
          updated_at: string
        }
        Insert: {
          booking_id: string
          category: string
          created_at?: string
          description: string
          guest_id: string
          host_id: string
          host_response?: string | null
          id?: string
          photos?: string[]
          property_id: string
          resolved_at?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Update: {
          booking_id?: string
          category?: string
          created_at?: string
          description?: string
          guest_id?: string
          host_id?: string
          host_response?: string | null
          id?: string
          photos?: string[]
          property_id?: string
          resolved_at?: string | null
          severity?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      bookings: {
        Row: {
          actual_check_in_at: string | null
          actual_check_out_at: string | null
          cancellation_reason: string | null
          check_in_date: string
          check_out_date: string
          cleaning_fee: number | null
          created_at: string
          currency: string | null
          guest_id: string
          guest_message: string | null
          host_approval_deadline: string | null
          host_approved_at: string | null
          host_declined_at: string | null
          host_id: string
          host_response: string | null
          id: string
          last_modified_at: string | null
          last_reminder_sent: Json
          modification_payment_session_id: string | null
          nightly_rate: number
          no_show_marked_at: string | null
          num_guests: number
          num_nights: number
          pending_modification: Json | null
          property_id: string
          receipt_downloaded_at: string | null
          refund_amount: number | null
          refund_date: string | null
          refund_reason: string | null
          refund_status: string | null
          service_fee: number | null
          status: Database["public"]["Enums"]["booking_status"]
          subtotal: number
          total_price: number
          updated_at: string
        }
        Insert: {
          actual_check_in_at?: string | null
          actual_check_out_at?: string | null
          cancellation_reason?: string | null
          check_in_date: string
          check_out_date: string
          cleaning_fee?: number | null
          created_at?: string
          currency?: string | null
          guest_id: string
          guest_message?: string | null
          host_approval_deadline?: string | null
          host_approved_at?: string | null
          host_declined_at?: string | null
          host_id: string
          host_response?: string | null
          id?: string
          last_modified_at?: string | null
          last_reminder_sent?: Json
          modification_payment_session_id?: string | null
          nightly_rate: number
          no_show_marked_at?: string | null
          num_guests?: number
          num_nights: number
          pending_modification?: Json | null
          property_id: string
          receipt_downloaded_at?: string | null
          refund_amount?: number | null
          refund_date?: string | null
          refund_reason?: string | null
          refund_status?: string | null
          service_fee?: number | null
          status?: Database["public"]["Enums"]["booking_status"]
          subtotal: number
          total_price: number
          updated_at?: string
        }
        Update: {
          actual_check_in_at?: string | null
          actual_check_out_at?: string | null
          cancellation_reason?: string | null
          check_in_date?: string
          check_out_date?: string
          cleaning_fee?: number | null
          created_at?: string
          currency?: string | null
          guest_id?: string
          guest_message?: string | null
          host_approval_deadline?: string | null
          host_approved_at?: string | null
          host_declined_at?: string | null
          host_id?: string
          host_response?: string | null
          id?: string
          last_modified_at?: string | null
          last_reminder_sent?: Json
          modification_payment_session_id?: string | null
          nightly_rate?: number
          no_show_marked_at?: string | null
          num_guests?: number
          num_nights?: number
          pending_modification?: Json | null
          property_id?: string
          receipt_downloaded_at?: string | null
          refund_amount?: number | null
          refund_date?: string | null
          refund_reason?: string | null
          refund_status?: string | null
          service_fee?: number | null
          status?: Database["public"]["Enums"]["booking_status"]
          subtotal?: number
          total_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          created_at: string
          id: string
          messages: Json
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          messages?: Json
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          messages?: Json
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      custom_roles: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_builtin: boolean
          name: string
          permissions: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_builtin?: boolean
          name: string
          permissions?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_builtin?: boolean
          name?: string
          permissions?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          property_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          property_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          property_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      finance_statement_approvals: {
        Row: {
          approver_id: string
          created_at: string
          display_currency: string
          id: string
          notes: string | null
          period_from: string
          period_to: string
          totals_snapshot: Json
          view_type: string
        }
        Insert: {
          approver_id: string
          created_at?: string
          display_currency?: string
          id?: string
          notes?: string | null
          period_from: string
          period_to: string
          totals_snapshot?: Json
          view_type?: string
        }
        Update: {
          approver_id?: string
          created_at?: string
          display_currency?: string
          id?: string
          notes?: string | null
          period_from?: string
          period_to?: string
          totals_snapshot?: Json
          view_type?: string
        }
        Relationships: []
      }
      force_majeure_events: {
        Row: {
          affected_cities: string[]
          affected_country: string
          affected_region: string | null
          created_at: string
          declared_by: string | null
          description: string | null
          ends_at: string
          event_type: string
          host_compensation_pct: number
          id: string
          is_active: boolean
          source_reference: string | null
          starts_at: string
          title: string
          updated_at: string
        }
        Insert: {
          affected_cities?: string[]
          affected_country: string
          affected_region?: string | null
          created_at?: string
          declared_by?: string | null
          description?: string | null
          ends_at: string
          event_type: string
          host_compensation_pct?: number
          id?: string
          is_active?: boolean
          source_reference?: string | null
          starts_at: string
          title: string
          updated_at?: string
        }
        Update: {
          affected_cities?: string[]
          affected_country?: string
          affected_region?: string | null
          created_at?: string
          declared_by?: string | null
          description?: string | null
          ends_at?: string
          event_type?: string
          host_compensation_pct?: number
          id?: string
          is_active?: boolean
          source_reference?: string | null
          starts_at?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      fraud_risk_scores: {
        Row: {
          action_taken: string | null
          base_score: number
          behavioural_signals: number
          booking_id: string
          created_at: string
          geo_signals: number
          guest_id: string
          id: string
          payment_signals: number
          score: number
          signals_detail: Json
          tier: string
          updated_at: string
        }
        Insert: {
          action_taken?: string | null
          base_score?: number
          behavioural_signals?: number
          booking_id: string
          created_at?: string
          geo_signals?: number
          guest_id: string
          id?: string
          payment_signals?: number
          score?: number
          signals_detail?: Json
          tier?: string
          updated_at?: string
        }
        Update: {
          action_taken?: string | null
          base_score?: number
          behavioural_signals?: number
          booking_id?: string
          created_at?: string
          geo_signals?: number
          guest_id?: string
          id?: string
          payment_signals?: number
          score?: number
          signals_detail?: Json
          tier?: string
          updated_at?: string
        }
        Relationships: []
      }
      host_deductions: {
        Row: {
          amount: number
          booking_id: string | null
          created_at: string
          created_by: string | null
          currency: string
          host_id: string
          id: string
          reason_code: string
          reason_detail: string | null
          settled_at: string | null
          settled_payout_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          host_id: string
          id?: string
          reason_code: string
          reason_detail?: string | null
          settled_at?: string | null
          settled_payout_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          host_id?: string
          id?: string
          reason_code?: string
          reason_detail?: string | null
          settled_at?: string | null
          settled_payout_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      host_payout_settings: {
        Row: {
          created_at: string
          current_tier: string
          host_id: string
          id: string
          long_stay_installments_enabled: boolean
          payout_account: Json
          payout_method: string
          release_mode: string
          starter_bookings_used: number
          tier_locked_until: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_tier?: string
          host_id: string
          id?: string
          long_stay_installments_enabled?: boolean
          payout_account?: Json
          payout_method?: string
          release_mode?: string
          starter_bookings_used?: number
          tier_locked_until?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_tier?: string
          host_id?: string
          id?: string
          long_stay_installments_enabled?: boolean
          payout_account?: Json
          payout_method?: string
          release_mode?: string
          starter_bookings_used?: number
          tier_locked_until?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      manual_review_queue: {
        Row: {
          assigned_to: string | null
          context: Json
          created_at: string
          entity_id: string
          entity_type: string
          fraud_score_id: string | null
          id: string
          reason: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          sla_due_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          assigned_to?: string | null
          context?: Json
          created_at?: string
          entity_id: string
          entity_type: string
          fraud_score_id?: string | null
          id?: string
          reason: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          sla_due_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string | null
          context?: Json
          created_at?: string
          entity_id?: string
          entity_type?: string
          fraud_score_id?: string | null
          id?: string
          reason?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          sla_due_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_review_queue_fraud_score_id_fkey"
            columns: ["fraud_score_id"]
            isOneToOne: false
            referencedRelation: "fraud_risk_scores"
            referencedColumns: ["id"]
          },
        ]
      }
      message_thread_states: {
        Row: {
          booking_id: string | null
          created_at: string
          id: string
          resolution_note: string | null
          resolved_at: string | null
          resolved_by: string | null
          updated_at: string
          user_a: string
          user_b: string
        }
        Insert: {
          booking_id?: string | null
          created_at?: string
          id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string
          user_a: string
          user_b: string
        }
        Update: {
          booking_id?: string | null
          created_at?: string
          id?: string
          resolution_note?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          updated_at?: string
          user_a?: string
          user_b?: string
        }
        Relationships: []
      }
      message_translations: {
        Row: {
          created_at: string
          message_id: string
          source_language: string | null
          target_language: string
          translation: string
        }
        Insert: {
          created_at?: string
          message_id: string
          source_language?: string | null
          target_language: string
          translation: string
        }
        Update: {
          created_at?: string
          message_id?: string
          source_language?: string | null
          target_language?: string
          translation?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_translations_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "messages"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          booking_id: string | null
          content: string
          created_at: string
          delivery_status: string
          id: string
          is_read: boolean | null
          message_type: string
          receiver_id: string
          scheduled_at: string | null
          sender_id: string
        }
        Insert: {
          booking_id?: string | null
          content: string
          created_at?: string
          delivery_status?: string
          id?: string
          is_read?: boolean | null
          message_type?: string
          receiver_id: string
          scheduled_at?: string | null
          sender_id: string
        }
        Update: {
          booking_id?: string | null
          content?: string
          created_at?: string
          delivery_status?: string
          id?: string
          is_read?: boolean | null
          message_type?: string
          receiver_id?: string
          scheduled_at?: string | null
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      messaging_mutes: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          muted_by: string
          reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          muted_by: string
          reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          muted_by?: string
          reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      mutual_reviews: {
        Row: {
          beddings_rating: number | null
          booking_id: string
          cleanliness_rating: number | null
          comment: string | null
          communication_rating: number | null
          created_at: string | null
          guest_id: string
          host_id: string
          id: string
          is_published: boolean | null
          location_rating: number | null
          overall_rating: number | null
          property_id: string
          review_window_closes_at: string
          reviewer_type: string
          security_rating: number | null
          updated_at: string | null
        }
        Insert: {
          beddings_rating?: number | null
          booking_id: string
          cleanliness_rating?: number | null
          comment?: string | null
          communication_rating?: number | null
          created_at?: string | null
          guest_id: string
          host_id: string
          id?: string
          is_published?: boolean | null
          location_rating?: number | null
          overall_rating?: number | null
          property_id: string
          review_window_closes_at: string
          reviewer_type: string
          security_rating?: number | null
          updated_at?: string | null
        }
        Update: {
          beddings_rating?: number | null
          booking_id?: string
          cleanliness_rating?: number | null
          comment?: string | null
          communication_rating?: number | null
          created_at?: string | null
          guest_id?: string
          host_id?: string
          id?: string
          is_published?: boolean | null
          location_rating?: number | null
          overall_rating?: number | null
          property_id?: string
          review_window_closes_at?: string
          reviewer_type?: string
          security_rating?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mutual_reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mutual_reviews_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_log: {
        Row: {
          body: string | null
          channel: string
          created_at: string
          error_message: string | null
          event_type: string
          external_id: string | null
          id: string
          is_read: boolean
          metadata: Json
          read_at: string | null
          related_entity_id: string | null
          related_entity_type: string | null
          sent_at: string | null
          status: string
          subject: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          channel: string
          created_at?: string
          error_message?: string | null
          event_type: string
          external_id?: string | null
          id?: string
          is_read?: boolean
          metadata?: Json
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          channel?: string
          created_at?: string
          error_message?: string | null
          event_type?: string
          external_id?: string | null
          id?: string
          is_read?: boolean
          metadata?: Json
          read_at?: string | null
          related_entity_id?: string | null
          related_entity_type?: string | null
          sent_at?: string | null
          status?: string
          subject?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notification_preferences_extended: {
        Row: {
          channel_overrides: Json
          created_at: string
          id: string
          push_token: string | null
          quiet_hours_end: string | null
          quiet_hours_start: string | null
          sms_phone: string | null
          timezone: string | null
          updated_at: string
          user_id: string
          whatsapp_opted_in: boolean
          whatsapp_phone: string | null
        }
        Insert: {
          channel_overrides?: Json
          created_at?: string
          id?: string
          push_token?: string | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          sms_phone?: string | null
          timezone?: string | null
          updated_at?: string
          user_id: string
          whatsapp_opted_in?: boolean
          whatsapp_phone?: string | null
        }
        Update: {
          channel_overrides?: Json
          created_at?: string
          id?: string
          push_token?: string | null
          quiet_hours_end?: string | null
          quiet_hours_start?: string | null
          sms_phone?: string | null
          timezone?: string | null
          updated_at?: string
          user_id?: string
          whatsapp_opted_in?: boolean
          whatsapp_phone?: string | null
        }
        Relationships: []
      }
      payout_holds: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          currency: string
          host_id: string
          id: string
          manual_override_by: string | null
          override_reason: string | null
          placed_at: string
          reason_code: string
          reason_detail: string | null
          released_at: string | null
          sla_due_at: string
          status: string
          status_log: Json
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          currency?: string
          host_id: string
          id?: string
          manual_override_by?: string | null
          override_reason?: string | null
          placed_at?: string
          reason_code: string
          reason_detail?: string | null
          released_at?: string | null
          sla_due_at: string
          status?: string
          status_log?: Json
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          currency?: string
          host_id?: string
          id?: string
          manual_override_by?: string | null
          override_reason?: string | null
          placed_at?: string
          reason_code?: string
          reason_detail?: string | null
          released_at?: string | null
          sla_due_at?: string
          status?: string
          status_log?: Json
          updated_at?: string
        }
        Relationships: []
      }
      payout_installments: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          currency: string
          host_id: string
          id: string
          installment_number: number
          nights_covered: number
          payout_id: string | null
          released_at: string | null
          scheduled_release_date: string
          status: string
          total_installments: number
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          currency?: string
          host_id: string
          id?: string
          installment_number: number
          nights_covered: number
          payout_id?: string | null
          released_at?: string | null
          scheduled_release_date: string
          status?: string
          total_installments: number
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          currency?: string
          host_id?: string
          id?: string
          installment_number?: number
          nights_covered?: number
          payout_id?: string | null
          released_at?: string | null
          scheduled_release_date?: string
          status?: string
          total_installments?: number
          updated_at?: string
        }
        Relationships: []
      }
      payouts: {
        Row: {
          amount: number
          booking_id: string
          created_at: string
          host_id: string
          id: string
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          processed_by: string | null
          status: string
          transaction_reference: string | null
          updated_at: string
        }
        Insert: {
          amount: number
          booking_id: string
          created_at?: string
          host_id: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          processed_by?: string | null
          status?: string
          transaction_reference?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          booking_id?: string
          created_at?: string
          host_id?: string
          id?: string
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          processed_by?: string | null
          status?: string
          transaction_reference?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payouts_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_controls: {
        Row: {
          id: string
          section: string
          settings: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: string
          section: string
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: string
          section?: string
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      platform_expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          created_by: string | null
          currency: string
          description: string
          expense_date: string
          id: string
          notes: string | null
          receipt_url: string | null
          updated_at: string
          vendor: string | null
        }
        Insert: {
          amount: number
          category: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description: string
          expense_date?: string
          id?: string
          notes?: string | null
          receipt_url?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string
          expense_date?: string
          id?: string
          notes?: string | null
          receipt_url?: string | null
          updated_at?: string
          vendor?: string | null
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          auto_message_templates: Json
          auto_message_timings: Json
          booking_id_length: number
          booking_id_prefix: string
          custom_auto_messages: Json
          disabled_auto_messages: string[]
          guest_id_length: number
          guest_id_prefix: string
          host_commission_percent: number
          host_id_length: number
          host_id_prefix: string
          host_tax_percent: number
          id: string
          platform_name: string
          review_window_days: number | null
          service_fee_percent: number
          service_tax_percent: number
          staff_id_length: number
          staff_id_prefix: string
          support_email: string
          support_phone: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_message_templates?: Json
          auto_message_timings?: Json
          booking_id_length?: number
          booking_id_prefix?: string
          custom_auto_messages?: Json
          disabled_auto_messages?: string[]
          guest_id_length?: number
          guest_id_prefix?: string
          host_commission_percent?: number
          host_id_length?: number
          host_id_prefix?: string
          host_tax_percent?: number
          id?: string
          platform_name?: string
          review_window_days?: number | null
          service_fee_percent?: number
          service_tax_percent?: number
          staff_id_length?: number
          staff_id_prefix?: string
          support_email?: string
          support_phone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_message_templates?: Json
          auto_message_timings?: Json
          booking_id_length?: number
          booking_id_prefix?: string
          custom_auto_messages?: Json
          disabled_auto_messages?: string[]
          guest_id_length?: number
          guest_id_prefix?: string
          host_commission_percent?: number
          host_id_length?: number
          host_id_prefix?: string
          host_tax_percent?: number
          id?: string
          platform_name?: string
          review_window_days?: number | null
          service_fee_percent?: number
          service_tax_percent?: number
          staff_id_length?: number
          staff_id_prefix?: string
          support_email?: string
          support_phone?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string
          email: string
          full_name: string | null
          fun_fact: string | null
          id: string
          is_host: boolean | null
          is_suspended: boolean | null
          is_verified: boolean | null
          languages: string | null
          location: string | null
          paypal_email: string | null
          phone: string | null
          pronouns: string | null
          property_relation: string | null
          suspended_at: string | null
          suspended_reason: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          fun_fact?: string | null
          id?: string
          is_host?: boolean | null
          is_suspended?: boolean | null
          is_verified?: boolean | null
          languages?: string | null
          location?: string | null
          paypal_email?: string | null
          phone?: string | null
          pronouns?: string | null
          property_relation?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          fun_fact?: string | null
          id?: string
          is_host?: boolean | null
          is_suspended?: boolean | null
          is_verified?: boolean | null
          languages?: string | null
          location?: string | null
          paypal_email?: string | null
          phone?: string | null
          pronouns?: string | null
          property_relation?: string | null
          suspended_at?: string | null
          suspended_reason?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string
          availability_settings: Json
          average_rating: number | null
          bathrooms: number
          bedrooms: number
          beds: number
          check_in_time: string | null
          check_out_time: string | null
          city: string
          cleaning_fee: number | null
          country: string
          cover_image: string | null
          created_at: string
          currency: string | null
          description: string | null
          host_id: string
          house_rules: string[] | null
          id: string
          images: string[] | null
          instant_booking: boolean | null
          latitude: number | null
          longitude: number | null
          max_guests: number
          max_nights: number | null
          min_nights: number | null
          photo_rules: Json
          postal_code: string | null
          price_per_night: number
          property_type: Database["public"]["Enums"]["property_type"]
          service_fee_charged_to: string
          service_fee_percent: number | null
          state: string | null
          status: Database["public"]["Enums"]["property_status"]
          timezone: string
          title: string
          total_bookings: number | null
          total_reviews: number | null
          updated_at: string
        }
        Insert: {
          address: string
          availability_settings?: Json
          average_rating?: number | null
          bathrooms?: number
          bedrooms?: number
          beds?: number
          check_in_time?: string | null
          check_out_time?: string | null
          city: string
          cleaning_fee?: number | null
          country: string
          cover_image?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          host_id: string
          house_rules?: string[] | null
          id?: string
          images?: string[] | null
          instant_booking?: boolean | null
          latitude?: number | null
          longitude?: number | null
          max_guests?: number
          max_nights?: number | null
          min_nights?: number | null
          photo_rules?: Json
          postal_code?: string | null
          price_per_night: number
          property_type?: Database["public"]["Enums"]["property_type"]
          service_fee_charged_to?: string
          service_fee_percent?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["property_status"]
          timezone?: string
          title: string
          total_bookings?: number | null
          total_reviews?: number | null
          updated_at?: string
        }
        Update: {
          address?: string
          availability_settings?: Json
          average_rating?: number | null
          bathrooms?: number
          bedrooms?: number
          beds?: number
          check_in_time?: string | null
          check_out_time?: string | null
          city?: string
          cleaning_fee?: number | null
          country?: string
          cover_image?: string | null
          created_at?: string
          currency?: string | null
          description?: string | null
          host_id?: string
          house_rules?: string[] | null
          id?: string
          images?: string[] | null
          instant_booking?: boolean | null
          latitude?: number | null
          longitude?: number | null
          max_guests?: number
          max_nights?: number | null
          min_nights?: number | null
          photo_rules?: Json
          postal_code?: string | null
          price_per_night?: number
          property_type?: Database["public"]["Enums"]["property_type"]
          service_fee_charged_to?: string
          service_fee_percent?: number | null
          state?: string | null
          status?: Database["public"]["Enums"]["property_status"]
          timezone?: string
          title?: string
          total_bookings?: number | null
          total_reviews?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      property_amenities: {
        Row: {
          amenity_id: string
          id: string
          property_id: string
        }
        Insert: {
          amenity_id: string
          id?: string
          property_id: string
        }
        Update: {
          amenity_id?: string
          id?: string
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_amenities_amenity_id_fkey"
            columns: ["amenity_id"]
            isOneToOne: false
            referencedRelation: "amenities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "property_amenities_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      property_availability: {
        Row: {
          created_at: string
          custom_price: number | null
          date: string
          id: string
          is_available: boolean | null
          property_id: string
        }
        Insert: {
          created_at?: string
          custom_price?: number | null
          date: string
          id?: string
          is_available?: boolean | null
          property_id: string
        }
        Update: {
          created_at?: string
          custom_price?: number | null
          date?: string
          id?: string
          is_available?: boolean | null
          property_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "property_availability_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          accuracy_rating: number | null
          booking_id: string
          checkin_rating: number | null
          cleanliness_rating: number | null
          comment: string | null
          communication_rating: number | null
          created_at: string
          guest_id: string
          host_id: string
          host_response: string | null
          id: string
          is_public: boolean | null
          location_rating: number | null
          overall_rating: number
          property_id: string
          updated_at: string
          value_rating: number | null
        }
        Insert: {
          accuracy_rating?: number | null
          booking_id: string
          checkin_rating?: number | null
          cleanliness_rating?: number | null
          comment?: string | null
          communication_rating?: number | null
          created_at?: string
          guest_id: string
          host_id: string
          host_response?: string | null
          id?: string
          is_public?: boolean | null
          location_rating?: number | null
          overall_rating: number
          property_id: string
          updated_at?: string
          value_rating?: number | null
        }
        Update: {
          accuracy_rating?: number | null
          booking_id?: string
          checkin_rating?: number | null
          cleanliness_rating?: number | null
          comment?: string | null
          communication_rating?: number | null
          created_at?: string
          guest_id?: string
          host_id?: string
          host_response?: string | null
          id?: string
          is_public?: boolean | null
          location_rating?: number | null
          overall_rating?: number
          property_id?: string
          updated_at?: string
          value_rating?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      sanctions_list: {
        Row: {
          aliases: string[]
          country: string | null
          created_at: string
          date_added: string | null
          full_name: string
          id: string
          is_active: boolean
          list_source: string
          notes: string | null
        }
        Insert: {
          aliases?: string[]
          country?: string | null
          created_at?: string
          date_added?: string | null
          full_name: string
          id?: string
          is_active?: boolean
          list_source: string
          notes?: string | null
        }
        Update: {
          aliases?: string[]
          country?: string | null
          created_at?: string
          date_added?: string | null
          full_name?: string
          id?: string
          is_active?: boolean
          list_source?: string
          notes?: string | null
        }
        Relationships: []
      }
      sanctions_screening_results: {
        Row: {
          created_at: string
          id: string
          match_score: number
          matched_sanction_id: string | null
          notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_score?: number
          matched_sanction_id?: string | null
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          match_score?: number
          matched_sanction_id?: string | null
          notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sanctions_screening_results_matched_sanction_id_fkey"
            columns: ["matched_sanction_id"]
            isOneToOne: false
            referencedRelation: "sanctions_list"
            referencedColumns: ["id"]
          },
        ]
      }
      user_custom_role_assignments: {
        Row: {
          assigned_by: string | null
          created_at: string
          custom_role_id: string
          id: string
          user_id: string
        }
        Insert: {
          assigned_by?: string | null
          created_at?: string
          custom_role_id: string
          id?: string
          user_id: string
        }
        Update: {
          assigned_by?: string | null
          created_at?: string
          custom_role_id?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_custom_role_assignments_custom_role_id_fkey"
            columns: ["custom_role_id"]
            isOneToOne: false
            referencedRelation: "custom_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_preferences: {
        Row: {
          accessibility_needs: string[]
          allow_search_engines: boolean
          automated_messages: Json
          created_at: string
          dietary_preferences: string[]
          font_size: string
          high_contrast: boolean
          id: string
          interests: string[]
          notif_booking_updates: boolean
          notif_messages: boolean
          notif_newsletter: boolean
          notif_price_alerts: boolean
          notif_promotions: boolean
          notif_push: boolean
          notif_reviews: boolean
          notif_security: boolean
          notif_sms: boolean
          preferred_currency: string
          profile_visibility: string
          quick_replies: Json
          reduce_motion: boolean
          screen_reader: boolean
          share_data_partners: boolean
          show_online_status: boolean
          show_reviews: boolean
          show_trips: boolean
          show_wishlist: boolean
          theme: string
          travel_style: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          accessibility_needs?: string[]
          allow_search_engines?: boolean
          automated_messages?: Json
          created_at?: string
          dietary_preferences?: string[]
          font_size?: string
          high_contrast?: boolean
          id?: string
          interests?: string[]
          notif_booking_updates?: boolean
          notif_messages?: boolean
          notif_newsletter?: boolean
          notif_price_alerts?: boolean
          notif_promotions?: boolean
          notif_push?: boolean
          notif_reviews?: boolean
          notif_security?: boolean
          notif_sms?: boolean
          preferred_currency?: string
          profile_visibility?: string
          quick_replies?: Json
          reduce_motion?: boolean
          screen_reader?: boolean
          share_data_partners?: boolean
          show_online_status?: boolean
          show_reviews?: boolean
          show_trips?: boolean
          show_wishlist?: boolean
          theme?: string
          travel_style?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          accessibility_needs?: string[]
          allow_search_engines?: boolean
          automated_messages?: Json
          created_at?: string
          dietary_preferences?: string[]
          font_size?: string
          high_contrast?: boolean
          id?: string
          interests?: string[]
          notif_booking_updates?: boolean
          notif_messages?: boolean
          notif_newsletter?: boolean
          notif_price_alerts?: boolean
          notif_promotions?: boolean
          notif_push?: boolean
          notif_reviews?: boolean
          notif_security?: boolean
          notif_sms?: boolean
          preferred_currency?: string
          profile_visibility?: string
          quick_replies?: Json
          reduce_motion?: boolean
          screen_reader?: boolean
          share_data_partners?: boolean
          show_online_status?: boolean
          show_reviews?: boolean
          show_trips?: boolean
          show_wishlist?: boolean
          theme?: string
          travel_style?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_verifications: {
        Row: {
          created_at: string
          data: Json | null
          id: string
          status: string
          updated_at: string
          user_id: string
          verification_type: string
          verified_at: string | null
        }
        Insert: {
          created_at?: string
          data?: Json | null
          id?: string
          status?: string
          updated_at?: string
          user_id: string
          verification_type: string
          verified_at?: string | null
        }
        Update: {
          created_at?: string
          data?: Json | null
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
          verification_type?: string
          verified_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      _acct_check_pin_lock: { Args: { p_host: string }; Returns: undefined }
      _acct_clear_pin_failures: { Args: { p_host: string }; Returns: undefined }
      _acct_register_pin_failure: {
        Args: { p_host: string }
        Returns: undefined
      }
      acct_admin_unlock_host: {
        Args: { p_host_id: string; p_reason?: string }
        Returns: Json
      }
      acct_default_account_for_charge: {
        Args: { p_charge_type: string }
        Returns: {
          acc_type: string
          code: string
          direction: string
          name: string
        }[]
      }
      acct_delete_draft_bank_charge: {
        Args: { p_charge_id: string }
        Returns: undefined
      }
      acct_import_hostly_bookings: {
        Args: { _host_id: string }
        Returns: {
          imported: number
          needs_fx: number
          skipped: number
        }[]
      }
      acct_pin_status: { Args: never; Returns: Json }
      acct_post_bank_charge: { Args: { p_charge_id: string }; Returns: string }
      acct_reset_books: {
        Args: { p_confirm: string; p_pin: string }
        Returns: Json
      }
      acct_run_self_test: { Args: never; Returns: Json }
      acct_seed_defaults: { Args: { _host_id: string }; Returns: undefined }
      acct_set_account_pin: {
        Args: { p_current_pin?: string; p_new_pin: string }
        Returns: undefined
      }
      acct_verify_account_pin: { Args: { p_pin: string }; Returns: boolean }
      acct_verify_account_pin_v2: { Args: { p_pin: string }; Returns: Json }
      acct_void_bank_charge: {
        Args: { p_charge_id: string; p_reason: string }
        Returns: undefined
      }
      admin_get_user_basic: {
        Args: { _user_id: string }
        Returns: {
          email: string
          full_name: string
          phone: string
          user_id: string
        }[]
      }
      calculate_host_tier: {
        Args: { _host_id: string }
        Returns: {
          avg_rating: number
          cancellation_rate: number
          commission_pct: number
          completed_bookings: number
          response_rate: number
          tier: string
        }[]
      }
      create_notification: {
        Args: {
          _body: string
          _channel: string
          _event_type: string
          _metadata?: Json
          _recipient_id: string
          _related_entity_id?: string
          _related_entity_type?: string
          _subject: string
        }
        Returns: string
      }
      get_property_blocked_dates: {
        Args: { _property_id: string }
        Returns: {
          check_in_date: string
          check_out_date: string
        }[]
      }
      get_public_preferences: {
        Args: { _user_id: string }
        Returns: {
          accessibility_needs: string[]
          dietary_preferences: string[]
          interests: string[]
          travel_style: string
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      settle_host_deductions_for_payout: {
        Args: { _payout_id: string }
        Returns: number
      }
    }
    Enums: {
      acct_account_type:
        | "asset"
        | "liability"
        | "equity"
        | "revenue"
        | "expense"
      acct_journal_source:
        | "booking"
        | "expense"
        | "manual"
        | "opening"
        | "depreciation"
        | "payout"
      acct_method: "cash" | "accrual"
      app_role:
        | "admin"
        | "host"
        | "guest"
        | "customer_care"
        | "finance_officer"
        | "hr"
        | "moderator"
        | "operations"
        | "marketing"
        | "cohost"
        | "superadmin"
      booking_status:
        | "pending"
        | "confirmed"
        | "cancelled"
        | "completed"
        | "rejected"
        | "pending_host_approval"
        | "expired"
        | "in_progress"
        | "disputed"
        | "closed"
        | "no_show"
      property_status:
        | "draft"
        | "pending_approval"
        | "active"
        | "inactive"
        | "rejected"
        | "suspended"
      property_type:
        | "apartment"
        | "house"
        | "villa"
        | "cabin"
        | "cottage"
        | "loft"
        | "studio"
        | "penthouse"
        | "resort"
        | "hotel"
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
  public: {
    Enums: {
      acct_account_type: ["asset", "liability", "equity", "revenue", "expense"],
      acct_journal_source: [
        "booking",
        "expense",
        "manual",
        "opening",
        "depreciation",
        "payout",
      ],
      acct_method: ["cash", "accrual"],
      app_role: [
        "admin",
        "host",
        "guest",
        "customer_care",
        "finance_officer",
        "hr",
        "moderator",
        "operations",
        "marketing",
        "cohost",
        "superadmin",
      ],
      booking_status: [
        "pending",
        "confirmed",
        "cancelled",
        "completed",
        "rejected",
        "pending_host_approval",
        "expired",
        "in_progress",
        "disputed",
        "closed",
        "no_show",
      ],
      property_status: [
        "draft",
        "pending_approval",
        "active",
        "inactive",
        "rejected",
        "suspended",
      ],
      property_type: [
        "apartment",
        "house",
        "villa",
        "cabin",
        "cottage",
        "loft",
        "studio",
        "penthouse",
        "resort",
        "hotel",
      ],
    },
  },
} as const
