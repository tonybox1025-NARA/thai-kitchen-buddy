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
  public: {
    Tables: {
      addon_groups: {
        Row: {
          created_at: string | null
          id: string
          kitchen_name: string | null
          max_select: number
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          kitchen_name?: string | null
          max_select?: number
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          kitchen_name?: string | null
          max_select?: number
          name?: string
        }
        Relationships: []
      }
      addon_options: {
        Row: {
          addon_group_id: string | null
          created_at: string | null
          id: string
          name: string
          price: number
          sort_order: number | null
        }
        Insert: {
          addon_group_id?: string | null
          created_at?: string | null
          id?: string
          name: string
          price?: number
          sort_order?: number | null
        }
        Update: {
          addon_group_id?: string | null
          created_at?: string | null
          id?: string
          name?: string
          price?: number
          sort_order?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "addon_options_group_id_fkey"
            columns: ["addon_group_id"]
            isOneToOne: false
            referencedRelation: "addon_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      bill_discounts: {
        Row: {
          amount: number
          applied_at: string
          applied_by: string | null
          bill_id: string
          created_at: string
          fixed_value: number | null
          free_item_id: string | null
          free_item_name: string | null
          id: string
          percent_value: number | null
          type: string
        }
        Insert: {
          amount: number
          applied_at?: string
          applied_by?: string | null
          bill_id: string
          created_at?: string
          fixed_value?: number | null
          free_item_id?: string | null
          free_item_name?: string | null
          id?: string
          percent_value?: number | null
          type: string
        }
        Update: {
          amount?: number
          applied_at?: string
          applied_by?: string | null
          bill_id?: string
          created_at?: string
          fixed_value?: number | null
          free_item_id?: string | null
          free_item_name?: string | null
          id?: string
          percent_value?: number | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "bill_discounts_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_discounts_applied_by_fkey"
            columns: ["applied_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bill_discounts_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
      bills: {
        Row: {
          cashier_id: string | null
          created_at: string
          discount_amount: number
          discount_note: string | null
          id: string
          is_test: boolean
          loyalty_discount_amount: number
          loyalty_reservation_source: string | null
          loyalty_reserved_at: string | null
          member_discount_amount: number
          member_id: string | null
          order_id: string
          paid_at: string | null
          points_redeemed: number
          rounding_adjustment: number
          rounding_mode: string
          service_fee_amount: number
          service_fee_rate: number
          shift_id: string | null
          status: Database["public"]["Enums"]["bill_status"]
          subtotal: number
          total: number
          vat_amount: number
          vat_mode: Database["public"]["Enums"]["vat_mode"]
          vat_rate: number
        }
        Insert: {
          cashier_id?: string | null
          created_at?: string
          discount_amount?: number
          discount_note?: string | null
          id?: string
          is_test?: boolean
          loyalty_discount_amount?: number
          loyalty_reservation_source?: string | null
          loyalty_reserved_at?: string | null
          member_discount_amount?: number
          member_id?: string | null
          order_id: string
          paid_at?: string | null
          points_redeemed?: number
          rounding_adjustment?: number
          rounding_mode?: string
          service_fee_amount?: number
          service_fee_rate?: number
          shift_id?: string | null
          status?: Database["public"]["Enums"]["bill_status"]
          subtotal?: number
          total?: number
          vat_amount?: number
          vat_mode?: Database["public"]["Enums"]["vat_mode"]
          vat_rate?: number
        }
        Update: {
          cashier_id?: string | null
          created_at?: string
          discount_amount?: number
          discount_note?: string | null
          id?: string
          is_test?: boolean
          loyalty_discount_amount?: number
          loyalty_reservation_source?: string | null
          loyalty_reserved_at?: string | null
          member_discount_amount?: number
          member_id?: string | null
          order_id?: string
          paid_at?: string | null
          points_redeemed?: number
          rounding_adjustment?: number
          rounding_mode?: string
          service_fee_amount?: number
          service_fee_rate?: number
          shift_id?: string | null
          status?: Database["public"]["Enums"]["bill_status"]
          subtotal?: number
          total?: number
          vat_amount?: number
          vat_mode?: Database["public"]["Enums"]["vat_mode"]
          vat_rate?: number
        }
        Relationships: [
          {
            foreignKeyName: "bills_cashier_id_fkey"
            columns: ["cashier_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_cashier_id_fkey"
            columns: ["cashier_id"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bills_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      catalog_reset_addon_backup: {
        Row: {
          backed_up_at: string
          group_id: string
          manager_menu_id: string | null
          menu_name_th: string
        }
        Insert: {
          backed_up_at?: string
          group_id: string
          manager_menu_id?: string | null
          menu_name_th: string
        }
        Update: {
          backed_up_at?: string
          group_id?: string
          manager_menu_id?: string | null
          menu_name_th?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          kitchen_zone_id: string | null
          name_en: string
          name_my: string
          name_th: string
          sort: number
        }
        Insert: {
          created_at?: string
          id?: string
          kitchen_zone_id?: string | null
          name_en: string
          name_my: string
          name_th: string
          sort?: number
        }
        Update: {
          created_at?: string
          id?: string
          kitchen_zone_id?: string | null
          name_en?: string
          name_my?: string
          name_th?: string
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "categories_kitchen_zone_id_fkey"
            columns: ["kitchen_zone_id"]
            isOneToOne: false
            referencedRelation: "kitchen_zones"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_menu_price_changes: {
        Row: {
          approved_by: string
          approved_by_name: string
          created_at: string
          error_message: string | null
          id: string
          manager_menu_id: string
          menu_id: string
          new_price: number
          old_price: number
          reason: string
          request_id: string
          requested_by: string
          status: string
          synced_at: string | null
        }
        Insert: {
          approved_by: string
          approved_by_name: string
          created_at?: string
          error_message?: string | null
          id?: string
          manager_menu_id: string
          menu_id: string
          new_price: number
          old_price: number
          reason: string
          request_id: string
          requested_by: string
          status?: string
          synced_at?: string | null
        }
        Update: {
          approved_by?: string
          approved_by_name?: string
          created_at?: string
          error_message?: string | null
          id?: string
          manager_menu_id?: string
          menu_id?: string
          new_price?: number
          old_price?: number
          reason?: string
          request_id?: string
          requested_by?: string
          status?: string
          synced_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "emergency_menu_price_changes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_menu_price_changes_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_menu_price_changes_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_menu_price_changes_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_menu_price_changes_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ingredients: {
        Row: {
          cost_per_unit: number
          created_at: string | null
          id: string
          name_english: string | null
          name_thai: string
          unit: string
          updated_at: string | null
        }
        Insert: {
          cost_per_unit?: number
          created_at?: string | null
          id?: string
          name_english?: string | null
          name_thai: string
          unit: string
          updated_at?: string | null
        }
        Update: {
          cost_per_unit?: number
          created_at?: string | null
          id?: string
          name_english?: string | null
          name_thai?: string
          unit?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      kitchen_zones: {
        Row: {
          active: boolean
          counter_group: string
          created_at: string
          id: string
          name_en: string
          name_th: string
          print_to_kitchen: boolean
          sort: number
        }
        Insert: {
          active?: boolean
          counter_group?: string
          created_at?: string
          id?: string
          name_en: string
          name_th: string
          print_to_kitchen?: boolean
          sort?: number
        }
        Update: {
          active?: boolean
          counter_group?: string
          created_at?: string
          id?: string
          name_en?: string
          name_th?: string
          print_to_kitchen?: boolean
          sort?: number
        }
        Relationships: []
      }
      loyalty_claim_tokens: {
        Row: {
          bill_id: string
          claim_points: number
          claimed_at: string | null
          created_at: string
          expires_at: string | null
          id: string
          member_id: string | null
          status: string
          token: string
          total_amount: number
        }
        Insert: {
          bill_id: string
          claim_points?: number
          claimed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          member_id?: string | null
          status?: string
          token: string
          total_amount?: number
        }
        Update: {
          bill_id?: string
          claim_points?: number
          claimed_at?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          member_id?: string | null
          status?: string
          token?: string
          total_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "loyalty_claim_tokens_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: true
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "loyalty_claim_tokens_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_merge_audit: {
        Row: {
          approved_by: string | null
          id: string
          merged_at: string
          merged_by: string | null
          merged_member_before: Json
          merged_member_id: string
          survivor_before: Json
          survivor_member_id: string | null
        }
        Insert: {
          approved_by?: string | null
          id?: string
          merged_at?: string
          merged_by?: string | null
          merged_member_before: Json
          merged_member_id: string
          survivor_before: Json
          survivor_member_id?: string | null
        }
        Update: {
          approved_by?: string | null
          id?: string
          merged_at?: string
          merged_by?: string | null
          merged_member_before?: Json
          merged_member_id?: string
          survivor_before?: Json
          survivor_member_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "member_merge_audit_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_merge_audit_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_merge_audit_survivor_member_id_fkey"
            columns: ["survivor_member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
        ]
      }
      member_point_ledger: {
        Row: {
          approved_by: string | null
          balance_after: number
          bill_id: string | null
          created_at: string
          description: string | null
          expires_at: string | null
          id: string
          member_id: string
          points: number
          refund_id: string | null
          type: string
        }
        Insert: {
          approved_by?: string | null
          balance_after: number
          bill_id?: string | null
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          member_id: string
          points: number
          refund_id?: string | null
          type: string
        }
        Update: {
          approved_by?: string | null
          balance_after?: number
          bill_id?: string | null
          created_at?: string
          description?: string | null
          expires_at?: string | null
          id?: string
          member_id?: string
          points?: number
          refund_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_point_ledger_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_point_ledger_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_point_ledger_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_point_ledger_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_point_ledger_refund_id_fkey"
            columns: ["refund_id"]
            isOneToOne: false
            referencedRelation: "refunds"
            referencedColumns: ["id"]
          },
        ]
      }
      members: {
        Row: {
          birthday: string | null
          created_at: string
          current_points: number
          email: string | null
          first_name: string | null
          full_name: string
          gender: string | null
          guest_token: string | null
          id: string
          imported_from: string | null
          last_name: string | null
          legacy_average_spend: number
          legacy_last_visit_at: string | null
          legacy_source_row: number | null
          legacy_total_spend: number
          legacy_visit_count: number
          line_user_id: string | null
          member_code: string | null
          member_group_en: string | null
          member_group_th: string | null
          member_level: string | null
          nickname: string | null
          notes: string | null
          opening_points: number
          phone: string | null
          status: string
          updated_at: string
        }
        Insert: {
          birthday?: string | null
          created_at?: string
          current_points?: number
          email?: string | null
          first_name?: string | null
          full_name: string
          gender?: string | null
          guest_token?: string | null
          id?: string
          imported_from?: string | null
          last_name?: string | null
          legacy_average_spend?: number
          legacy_last_visit_at?: string | null
          legacy_source_row?: number | null
          legacy_total_spend?: number
          legacy_visit_count?: number
          line_user_id?: string | null
          member_code?: string | null
          member_group_en?: string | null
          member_group_th?: string | null
          member_level?: string | null
          nickname?: string | null
          notes?: string | null
          opening_points?: number
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          birthday?: string | null
          created_at?: string
          current_points?: number
          email?: string | null
          first_name?: string | null
          full_name?: string
          gender?: string | null
          guest_token?: string | null
          id?: string
          imported_from?: string | null
          last_name?: string | null
          legacy_average_spend?: number
          legacy_last_visit_at?: string | null
          legacy_source_row?: number | null
          legacy_total_spend?: number
          legacy_visit_count?: number
          line_user_id?: string | null
          member_code?: string | null
          member_group_en?: string | null
          member_group_th?: string | null
          member_level?: string | null
          nickname?: string | null
          notes?: string | null
          opening_points?: number
          phone?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      menu_addon_duplicate_backup_20260919: {
        Row: {
          created_at: string | null
          group_id: string | null
          id: string
          menu_id: string | null
        }
        Insert: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          menu_id?: string | null
        }
        Update: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          menu_id?: string | null
        }
        Relationships: []
      }
      menu_addons: {
        Row: {
          created_at: string | null
          group_id: string | null
          id: string
          menu_id: string | null
        }
        Insert: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          menu_id?: string | null
        }
        Update: {
          created_at?: string | null
          group_id?: string | null
          id?: string
          menu_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "menu_addons_addon_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "addon_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_addons_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "addon_groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_addons_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_duplicate_backup_20260919: {
        Row: {
          available: boolean
          category_id: string | null
          cost: number | null
          created_at: string
          id: string
          image_url: string | null
          is_set: boolean
          is_set_child: boolean
          manager_menu_id: string | null
          name_en: string
          name_my: string
          name_th: string
          price: number
          sort: number
        }
        Insert: {
          available?: boolean
          category_id?: string | null
          cost?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_set?: boolean
          is_set_child?: boolean
          manager_menu_id?: string | null
          name_en: string
          name_my: string
          name_th: string
          price: number
          sort?: number
        }
        Update: {
          available?: boolean
          category_id?: string | null
          cost?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_set?: boolean
          is_set_child?: boolean
          manager_menu_id?: string | null
          name_en?: string
          name_my?: string
          name_th?: string
          price?: number
          sort?: number
        }
        Relationships: []
      }
      menu_duplicate_cleanup_map_20260919: {
        Row: {
          canonical_id: string
          cleaned_at: string
          duplicate_id: string
          name_th: string | null
          price: number | null
        }
        Insert: {
          canonical_id: string
          cleaned_at?: string
          duplicate_id: string
          name_th?: string | null
          price?: number | null
        }
        Update: {
          canonical_id?: string
          cleaned_at?: string
          duplicate_id?: string
          name_th?: string | null
          price?: number | null
        }
        Relationships: []
      }
      menu_ingredients: {
        Row: {
          created_at: string | null
          id: string
          ingredient_id: string | null
          menu_id: string | null
          quantity: number
        }
        Insert: {
          created_at?: string | null
          id?: string
          ingredient_id?: string | null
          menu_id?: string | null
          quantity?: number
        }
        Update: {
          created_at?: string | null
          id?: string
          ingredient_id?: string | null
          menu_id?: string | null
          quantity?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_ingredients_ingredient_id_fkey"
            columns: ["ingredient_id"]
            isOneToOne: false
            referencedRelation: "ingredients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_ingredients_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_set_items: {
        Row: {
          child_menu_id: string
          created_at: string
          group_key: string
          group_name: string
          id: string
          manager_set_item_id: string | null
          max_select: number
          min_select: number
          quantity: number
          set_menu_id: string
          sort_order: number
        }
        Insert: {
          child_menu_id: string
          created_at?: string
          group_key?: string
          group_name?: string
          id?: string
          manager_set_item_id?: string | null
          max_select?: number
          min_select?: number
          quantity?: number
          set_menu_id: string
          sort_order?: number
        }
        Update: {
          child_menu_id?: string
          created_at?: string
          group_key?: string
          group_name?: string
          id?: string
          manager_set_item_id?: string | null
          max_select?: number
          min_select?: number
          quantity?: number
          set_menu_id?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "menu_set_items_child_menu_id_fkey"
            columns: ["child_menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_set_items_set_menu_id_fkey"
            columns: ["set_menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
        ]
      }
      menus: {
        Row: {
          available: boolean
          category_id: string | null
          cost: number | null
          created_at: string
          id: string
          image_url: string | null
          is_set: boolean
          is_set_child: boolean
          manager_menu_id: string | null
          name_en: string
          name_my: string
          name_th: string
          price: number
          sort: number
        }
        Insert: {
          available?: boolean
          category_id?: string | null
          cost?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_set?: boolean
          is_set_child?: boolean
          manager_menu_id?: string | null
          name_en: string
          name_my: string
          name_th: string
          price: number
          sort?: number
        }
        Update: {
          available?: boolean
          category_id?: string | null
          cost?: number | null
          created_at?: string
          id?: string
          image_url?: string | null
          is_set?: boolean
          is_set_child?: boolean
          manager_menu_id?: string | null
          name_en?: string
          name_my?: string
          name_th?: string
          price?: number
          sort?: number
        }
        Relationships: [
          {
            foreignKeyName: "menus_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      order_items: {
        Row: {
          created_at: string
          id: string
          is_takeout: boolean
          menu_id: string | null
          modifiers: Json | null
          name_en: string
          name_my: string
          name_th: string
          notes: string | null
          order_id: string
          qty: number
          round_number: number | null
          round_source: string | null
          sent_at: string | null
          set_config: Json | null
          status: Database["public"]["Enums"]["order_item_status"]
          unit_cost: number | null
          unit_price: number
          void_reason: string | null
          voided_at: string | null
          voided_by: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          is_takeout?: boolean
          menu_id?: string | null
          modifiers?: Json | null
          name_en: string
          name_my: string
          name_th: string
          notes?: string | null
          order_id: string
          qty: number
          round_number?: number | null
          round_source?: string | null
          sent_at?: string | null
          set_config?: Json | null
          status?: Database["public"]["Enums"]["order_item_status"]
          unit_cost?: number | null
          unit_price: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          is_takeout?: boolean
          menu_id?: string | null
          modifiers?: Json | null
          name_en?: string
          name_my?: string
          name_th?: string
          notes?: string | null
          order_id?: string
          qty?: number
          round_number?: number | null
          round_source?: string | null
          sent_at?: string | null
          set_config?: Json | null
          status?: Database["public"]["Enums"]["order_item_status"]
          unit_cost?: number | null
          unit_price?: number
          void_reason?: string | null
          voided_at?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "order_items_menu_id_fkey"
            columns: ["menu_id"]
            isOneToOne: false
            referencedRelation: "menus"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_items_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
        ]
      }
      order_table_merges: {
        Row: {
          id: string
          merged_at: string
          merged_by: string | null
          source_guests: number
          source_order_id: string
          source_subtotal: number
          source_table_id: string
          target_order_id: string
          target_table_id: string
        }
        Insert: {
          id?: string
          merged_at?: string
          merged_by?: string | null
          source_guests?: number
          source_order_id: string
          source_subtotal?: number
          source_table_id: string
          target_order_id: string
          target_table_id: string
        }
        Update: {
          id?: string
          merged_at?: string
          merged_by?: string | null
          source_guests?: number
          source_order_id?: string
          source_subtotal?: number
          source_table_id?: string
          target_order_id?: string
          target_table_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "order_table_merges_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_table_merges_merged_by_fkey"
            columns: ["merged_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_table_merges_source_order_id_fkey"
            columns: ["source_order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_table_merges_source_table_id_fkey"
            columns: ["source_table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_table_merges_target_order_id_fkey"
            columns: ["target_order_id"]
            isOneToOne: false
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "order_table_merges_target_table_id_fkey"
            columns: ["target_table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      orders: {
        Row: {
          cancel_reason: string | null
          checkout_requested_at: string | null
          closed_at: string | null
          closed_by: string | null
          guests: number
          id: string
          is_test: boolean
          next_round: number
          opened_at: string
          opened_by: string | null
          order_number: string | null
          shift_id: string | null
          source: Database["public"]["Enums"]["order_source"]
          staff_debtor_id: string | null
          status: Database["public"]["Enums"]["order_status"]
          table_id: string | null
        }
        Insert: {
          cancel_reason?: string | null
          checkout_requested_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
          guests?: number
          id?: string
          is_test?: boolean
          next_round?: number
          opened_at?: string
          opened_by?: string | null
          order_number?: string | null
          shift_id?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          staff_debtor_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_id?: string | null
        }
        Update: {
          cancel_reason?: string | null
          checkout_requested_at?: string | null
          closed_at?: string | null
          closed_by?: string | null
          guests?: number
          id?: string
          is_test?: boolean
          next_round?: number
          opened_at?: string
          opened_by?: string | null
          order_number?: string | null
          shift_id?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          staff_debtor_id?: string | null
          status?: Database["public"]["Enums"]["order_status"]
          table_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "orders_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_staff_debtor_id_fkey"
            columns: ["staff_debtor_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_staff_debtor_id_fkey"
            columns: ["staff_debtor_id"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "orders_table_id_fkey"
            columns: ["table_id"]
            isOneToOne: false
            referencedRelation: "restaurant_tables"
            referencedColumns: ["id"]
          },
        ]
      }
      payments: {
        Row: {
          amount: number
          bill_id: string
          cash_breakdown: Json | null
          cash_received: number | null
          change_due: number | null
          created_at: string
          id: string
          method: Database["public"]["Enums"]["payment_method"]
          reference: string | null
          tip_amount: number
        }
        Insert: {
          amount: number
          bill_id: string
          cash_breakdown?: Json | null
          cash_received?: number | null
          change_due?: number | null
          created_at?: string
          id?: string
          method: Database["public"]["Enums"]["payment_method"]
          reference?: string | null
          tip_amount?: number
        }
        Update: {
          amount?: number
          bill_id?: string
          cash_breakdown?: Json | null
          cash_received?: number | null
          change_due?: number | null
          created_at?: string
          id?: string
          method?: Database["public"]["Enums"]["payment_method"]
          reference?: string | null
          tip_amount?: number
        }
        Relationships: [
          {
            foreignKeyName: "payments_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
        ]
      }
      print_jobs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          payload: Json
          printed_at: string | null
          printer: Database["public"]["Enums"]["printer_kind"]
          status: Database["public"]["Enums"]["print_status"]
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          payload: Json
          printed_at?: string | null
          printer: Database["public"]["Enums"]["printer_kind"]
          status?: Database["public"]["Enums"]["print_status"]
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          printed_at?: string | null
          printer?: Database["public"]["Enums"]["printer_kind"]
          status?: Database["public"]["Enums"]["print_status"]
        }
        Relationships: []
      }
      refunds: {
        Row: {
          amount: number
          bill_id: string | null
          created_at: string
          id: string
          original_payment_breakdown: Json
          payout_method: string
          reason: string
          refunded_by: string | null
          shift_id: string | null
        }
        Insert: {
          amount: number
          bill_id?: string | null
          created_at?: string
          id?: string
          original_payment_breakdown?: Json
          payout_method?: string
          reason: string
          refunded_by?: string | null
          shift_id?: string | null
        }
        Update: {
          amount?: number
          bill_id?: string | null
          created_at?: string
          id?: string
          original_payment_breakdown?: Json
          payout_method?: string
          reason?: string
          refunded_by?: string | null
          shift_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "refunds_bill_id_fkey"
            columns: ["bill_id"]
            isOneToOne: false
            referencedRelation: "bills"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_refunded_by_fkey"
            columns: ["refunded_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_refunded_by_fkey"
            columns: ["refunded_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "refunds_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
        ]
      }
      restaurant_tables: {
        Row: {
          capacity: number
          code: string
          created_at: string
          guests: number
          has_qr_alert: boolean
          id: string
          is_test: boolean
          pos_x: number
          pos_y: number
          status: Database["public"]["Enums"]["table_status"]
        }
        Insert: {
          capacity?: number
          code: string
          created_at?: string
          guests?: number
          has_qr_alert?: boolean
          id?: string
          is_test?: boolean
          pos_x?: number
          pos_y?: number
          status?: Database["public"]["Enums"]["table_status"]
        }
        Update: {
          capacity?: number
          code?: string
          created_at?: string
          guests?: number
          has_qr_alert?: boolean
          id?: string
          is_test?: boolean
          pos_x?: number
          pos_y?: number
          status?: Database["public"]["Enums"]["table_status"]
        }
        Relationships: []
      }
      settings: {
        Row: {
          address: string | null
          current_business_day: string
          gov_qr_customer_percent: number
          gov_qr_enabled: boolean
          gov_qr_government_percent: number
          gov_qr_label: string
          id: number
          loyalty_enabled: boolean
          loyalty_points_expire_months: number
          loyalty_points_per_baht: number
          loyalty_signup_bonus: number
          max_discount_percent: number
          printer_counter_ip: string | null
          printer_kitchen_ip: string | null
          qr_time_buckets: Json
          receipt_logo_url: string | null
          receipt_promo: string | null
          restaurant_name: string
          rounding_mode: string
          service_fee_rate: number
          starting_cash: number
          updated_at: string
          vat_enabled: boolean
          vat_mode: Database["public"]["Enums"]["vat_mode"]
          vat_rate: number
        }
        Insert: {
          address?: string | null
          current_business_day?: string
          gov_qr_customer_percent?: number
          gov_qr_enabled?: boolean
          gov_qr_government_percent?: number
          gov_qr_label?: string
          id?: number
          loyalty_enabled?: boolean
          loyalty_points_expire_months?: number
          loyalty_points_per_baht?: number
          loyalty_signup_bonus?: number
          max_discount_percent?: number
          printer_counter_ip?: string | null
          printer_kitchen_ip?: string | null
          qr_time_buckets?: Json
          receipt_logo_url?: string | null
          receipt_promo?: string | null
          restaurant_name?: string
          rounding_mode?: string
          service_fee_rate?: number
          starting_cash?: number
          updated_at?: string
          vat_enabled?: boolean
          vat_mode?: Database["public"]["Enums"]["vat_mode"]
          vat_rate?: number
        }
        Update: {
          address?: string | null
          current_business_day?: string
          gov_qr_customer_percent?: number
          gov_qr_enabled?: boolean
          gov_qr_government_percent?: number
          gov_qr_label?: string
          id?: number
          loyalty_enabled?: boolean
          loyalty_points_expire_months?: number
          loyalty_points_per_baht?: number
          loyalty_signup_bonus?: number
          max_discount_percent?: number
          printer_counter_ip?: string | null
          printer_kitchen_ip?: string | null
          qr_time_buckets?: Json
          receipt_logo_url?: string | null
          receipt_promo?: string | null
          restaurant_name?: string
          rounding_mode?: string
          service_fee_rate?: number
          starting_cash?: number
          updated_at?: string
          vat_enabled?: boolean
          vat_mode?: Database["public"]["Enums"]["vat_mode"]
          vat_rate?: number
        }
        Relationships: []
      }
      shifts: {
        Row: {
          business_day: string
          cash_count: Json | null
          closed_at: string | null
          closed_by: string | null
          id: string
          opened_at: string
          opened_by: string | null
          opening_float: number
          status: Database["public"]["Enums"]["shift_status"]
          totals: Json | null
        }
        Insert: {
          business_day: string
          cash_count?: Json | null
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          opened_at?: string
          opened_by?: string | null
          opening_float?: number
          status?: Database["public"]["Enums"]["shift_status"]
          totals?: Json | null
        }
        Update: {
          business_day?: string
          cash_count?: Json | null
          closed_at?: string | null
          closed_by?: string | null
          id?: string
          opened_at?: string
          opened_by?: string | null
          opening_float?: number
          status?: Database["public"]["Enums"]["shift_status"]
          totals?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_closed_by_fkey"
            columns: ["closed_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "shifts_opened_by_fkey"
            columns: ["opened_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
        ]
      }
      staff: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name: string
          pin_hash: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name: string
          pin_hash: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name?: string
          pin_hash?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      staff_tab_charges: {
        Row: {
          amount: number
          charged_at: string
          charged_by: string | null
          id: string
          order_id: string
          settled_at: string | null
          shift_id: string
          staff_id: string
          status: string
        }
        Insert: {
          amount: number
          charged_at?: string
          charged_by?: string | null
          id?: string
          order_id: string
          settled_at?: string | null
          shift_id: string
          staff_id: string
          status?: string
        }
        Update: {
          amount?: number
          charged_at?: string
          charged_by?: string | null
          id?: string
          order_id?: string
          settled_at?: string | null
          shift_id?: string
          staff_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_tab_charges_charged_by_fkey"
            columns: ["charged_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tab_charges_charged_by_fkey"
            columns: ["charged_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tab_charges_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: true
            referencedRelation: "orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tab_charges_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tab_charges_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tab_charges_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_tab_settlement_items: {
        Row: {
          amount: number
          charge_id: string
          settlement_id: string
        }
        Insert: {
          amount: number
          charge_id: string
          settlement_id: string
        }
        Update: {
          amount?: number
          charge_id?: string
          settlement_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_tab_settlement_items_charge_id_fkey"
            columns: ["charge_id"]
            isOneToOne: true
            referencedRelation: "staff_tab_charges"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tab_settlement_items_settlement_id_fkey"
            columns: ["settlement_id"]
            isOneToOne: false
            referencedRelation: "staff_tab_settlements"
            referencedColumns: ["id"]
          },
        ]
      }
      staff_tab_settlements: {
        Row: {
          amount: number
          created_at: string
          id: string
          method: string
          received_by: string | null
          shift_id: string
          staff_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          method: string
          received_by?: string | null
          shift_id: string
          staff_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          method?: string
          received_by?: string | null
          shift_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "staff_tab_settlements_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tab_settlements_received_by_fkey"
            columns: ["received_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tab_settlements_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tab_settlements_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "staff_tab_settlements_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
        ]
      }
      voids: {
        Row: {
          amount: number
          created_at: string
          id: string
          order_item_id: string | null
          reason: string
          shift_id: string | null
          voided_by: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          id?: string
          order_item_id?: string | null
          reason: string
          shift_id?: string | null
          voided_by?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          order_item_id?: string | null
          reason?: string
          shift_id?: string | null
          voided_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "voids_order_item_id_fkey"
            columns: ["order_item_id"]
            isOneToOne: false
            referencedRelation: "order_items"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voids_shift_id_fkey"
            columns: ["shift_id"]
            isOneToOne: false
            referencedRelation: "shifts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voids_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "staff"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voids_voided_by_fkey"
            columns: ["voided_by"]
            isOneToOne: false
            referencedRelation: "staff_public"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      staff_public: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string | null
          name: string | null
          role: Database["public"]["Enums"]["app_role"] | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string | null
          name?: string | null
          role?: Database["public"]["Enums"]["app_role"] | null
        }
        Relationships: []
      }
    }
    Functions: {
      adjust_member_points: {
        Args: {
          p_delta: number
          p_manager_pin: string
          p_member_id: string
          p_reason: string
        }
        Returns: {
          approved_by: string
          balance_after: number
        }[]
      }
      allocate_order_round: { Args: { p_order_id: string }; Returns: number }
      claim_receipt_loyalty_points: {
        Args: { p_claim_token: string; p_guest_token: string }
        Returns: {
          claim_status: string
          current_points: number
          member_group_en: string
          member_id: string
          member_name: string
          points_awarded: number
        }[]
      }
      combine_open_table_orders: {
        Args: {
          p_merged_by?: string
          p_source_order_id: string
          p_target_order_id: string
        }
        Returns: {
          combined_guests: number
          combined_subtotal: number
          source_table_code: string
        }[]
      }
      create_or_get_member: {
        Args: {
          p_full_name: string
          p_imported_from: string
          p_nickname: string
          p_phone: string
          p_signup_description: string
          p_signup_points: number
        }
        Returns: Json
      }
      create_staff: {
        Args: {
          _admin_pin?: string
          _name: string
          _pin: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      delete_staff: {
        Args: { _admin_pin?: string; _id: string }
        Returns: undefined
      }
      expire_due_member_points: {
        Args: never
        Returns: {
          members_expired: number
          points_expired: number
        }[]
      }
      finalize_bill_payment: {
        Args: {
          p_bill_id: string
          p_cashier_id?: string
          p_earn_points?: number
          p_member_id?: string
          p_redeem_points?: number
        }
        Returns: {
          balance_after: number
          bill_status: Database["public"]["Enums"]["bill_status"]
        }[]
      }
      finish_emergency_menu_price_change: {
        Args: {
          p_error_message?: string
          p_request_id: string
          p_success: boolean
        }
        Returns: undefined
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _staff_id: string
        }
        Returns: boolean
      }
      is_admin_pin: { Args: { _pin: string }; Returns: boolean }
      list_staff: {
        Args: never
        Returns: {
          active: boolean
          id: string
          name: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      merge_duplicate_members: {
        Args: {
          p_manager_pin: string
          p_merged_member_id: string
          p_survivor_member_id: string
        }
        Returns: Json
      }
      normalize_member_phone: { Args: { p_phone: string }; Returns: string }
      prepare_emergency_menu_price_change: {
        Args: {
          p_manager_pin: string
          p_menu_id: string
          p_new_price: number
          p_reason: string
          p_request_id: string
          p_requested_by: string
        }
        Returns: {
          approved_by: string
          approved_by_name: string
          change_id: string
          manager_menu_id: string
          new_price: number
          old_price: number
        }[]
      }
      process_bill_loyalty: {
        Args: {
          p_bill_id: string
          p_earn_points: number
          p_member_id: string
          p_redeem_points: number
        }
        Returns: {
          balance_after: number
          earned: number
          redeemed: number
        }[]
      }
      record_manual_member_points: {
        Args: {
          p_description: string
          p_manager_pin: string
          p_member_id: string
          p_points: number
          p_type: string
        }
        Returns: {
          approved_by: string
          balance_after: number
        }[]
      }
      record_staff_tab_charge: {
        Args: { p_charged_by: string; p_order_id: string }
        Returns: {
          amount: number
          charge_id: string
        }[]
      }
      refund_bill_with_loyalty: {
        Args: {
          p_amount: number
          p_bill_id: string
          p_reason: string
          p_refunded_by: string
        }
        Returns: {
          amount: number
          bill_id: string | null
          created_at: string
          id: string
          original_payment_breakdown: Json
          payout_method: string
          reason: string
          refunded_by: string | null
          shift_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "refunds"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      reserve_customer_bill_loyalty: {
        Args: {
          p_bill_id: string
          p_guest_token: string
          p_redeem_points: number
        }
        Returns: {
          available_points: number
          current_points: number
          discount_amount: number
          member_id: string
          member_name: string
          reserved_points: number
        }[]
      }
      set_staff_pin: {
        Args: { _admin_pin?: string; _pin: string; _staff_id: string }
        Returns: undefined
      }
      settle_staff_tab: {
        Args: {
          p_method: string
          p_pin: string
          p_received_by: string
          p_staff_id: string
        }
        Returns: {
          amount: number
          settlement_id: string
        }[]
      }
      staff_tab_summary: {
        Args: never
        Returns: {
          oldest_charge: string
          outstanding: number
          staff_id: string
          staff_name: string
          unpaid_count: number
        }[]
      }
      start_staff_tab_order: {
        Args: { p_opened_by: string; p_pin: string; p_staff_id: string }
        Returns: {
          order_id: string
          order_number: string
          staff_name: string
        }[]
      }
      verify_staff_pin: {
        Args: { _pin: string }
        Returns: {
          id: string
          name: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "manager" | "staff"
      bill_status: "open" | "paid" | "refunded" | "partial_refund"
      order_item_status: "pending" | "sent" | "served" | "voided"
      order_source: "pos" | "qr" | "takeout" | "staff_meal"
      order_status: "open" | "closed" | "cancelled"
      payment_method: "qr" | "cash" | "card" | "gov_qr"
      print_status: "pending" | "printed" | "failed"
      printer_kind: "counter" | "kitchen"
      shift_status: "open" | "closed"
      table_status: "available" | "occupied" | "bill_requested"
      vat_mode: "inclusive" | "exclusive"
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
  public: {
    Enums: {
      app_role: ["admin", "manager", "staff"],
      bill_status: ["open", "paid", "refunded", "partial_refund"],
      order_item_status: ["pending", "sent", "served", "voided"],
      order_source: ["pos", "qr", "takeout", "staff_meal"],
      order_status: ["open", "closed", "cancelled"],
      payment_method: ["qr", "cash", "card", "gov_qr"],
      print_status: ["pending", "printed", "failed"],
      printer_kind: ["counter", "kitchen"],
      shift_status: ["open", "closed"],
      table_status: ["available", "occupied", "bill_requested"],
      vat_mode: ["inclusive", "exclusive"],
    },
  },
} as const
