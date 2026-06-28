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
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          kitchen_name?: string | null
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          kitchen_name?: string | null
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
          member_discount_amount: number
          order_id: string
          paid_at: string | null
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
          member_discount_amount?: number
          order_id: string
          paid_at?: string | null
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
          member_discount_amount?: number
          order_id?: string
          paid_at?: string | null
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
      kitchen_zones: {
        Row: {
          active: boolean
          created_at: string
          id: string
          name_en: string
          name_th: string
          sort: number
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          name_en: string
          name_th: string
          sort?: number
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          name_en?: string
          name_th?: string
          sort?: number
        }
        Relationships: []
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
      menus: {
        Row: {
          available: boolean
          category_id: string | null
          cost: number | null
          created_at: string
          id: string
          image_url: string | null
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
          menu_id: string | null
          modifiers: Json | null
          name_en: string
          name_my: string
          name_th: string
          notes: string | null
          order_id: string
          qty: number
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
          menu_id?: string | null
          modifiers?: Json | null
          name_en: string
          name_my: string
          name_th: string
          notes?: string | null
          order_id: string
          qty: number
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
          menu_id?: string | null
          modifiers?: Json | null
          name_en?: string
          name_my?: string
          name_th?: string
          notes?: string | null
          order_id?: string
          qty?: number
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
      orders: {
        Row: {
          cancel_reason: string | null
          closed_at: string | null
          closed_by: string | null
          guests: number
          id: string
          opened_at: string
          opened_by: string | null
          order_number: string | null
          shift_id: string | null
          source: Database["public"]["Enums"]["order_source"]
          status: Database["public"]["Enums"]["order_status"]
          table_id: string | null
        }
        Insert: {
          cancel_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          guests?: number
          id?: string
          opened_at?: string
          opened_by?: string | null
          order_number?: string | null
          shift_id?: string | null
          source?: Database["public"]["Enums"]["order_source"]
          status?: Database["public"]["Enums"]["order_status"]
          table_id?: string | null
        }
        Update: {
          cancel_reason?: string | null
          closed_at?: string | null
          closed_by?: string | null
          guests?: number
          id?: string
          opened_at?: string
          opened_by?: string | null
          order_number?: string | null
          shift_id?: string | null
          source?: Database["public"]["Enums"]["order_source"]
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
          reason: string
          refunded_by: string | null
          shift_id: string | null
        }
        Insert: {
          amount: number
          bill_id?: string | null
          created_at?: string
          id?: string
          reason: string
          refunded_by?: string | null
          shift_id?: string | null
        }
        Update: {
          amount?: number
          bill_id?: string | null
          created_at?: string
          id?: string
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
          pos_x?: number
          pos_y?: number
          status?: Database["public"]["Enums"]["table_status"]
        }
        Relationships: []
      }
      settings: {
        Row: {
          current_business_day: string
          id: number
          printer_counter_ip: string | null
          printer_kitchen_ip: string | null
          restaurant_name: string
          max_discount_percent: number
          rounding_mode: string
          service_fee_rate: number
          starting_cash: number
          updated_at: string
          vat_enabled: boolean
          vat_mode: Database["public"]["Enums"]["vat_mode"]
          vat_rate: number
        }
        Insert: {
          current_business_day?: string
          id?: number
          printer_counter_ip?: string | null
          printer_kitchen_ip?: string | null
          restaurant_name?: string
          max_discount_percent?: number
          rounding_mode?: string
          service_fee_rate?: number
          starting_cash?: number
          updated_at?: string
          vat_enabled?: boolean
          vat_mode?: Database["public"]["Enums"]["vat_mode"]
          vat_rate?: number
        }
        Update: {
          current_business_day?: string
          id?: number
          printer_counter_ip?: string | null
          printer_kitchen_ip?: string | null
          restaurant_name?: string
          max_discount_percent?: number
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
      create_staff: {
        Args: {
          _name: string
          _pin: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: string
      }
      delete_staff: { Args: { _id: string }; Returns: undefined }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _staff_id: string
        }
        Returns: boolean
      }
      list_staff: {
        Args: never
        Returns: {
          active: boolean
          id: string
          name: string
          role: Database["public"]["Enums"]["app_role"]
        }[]
      }
      set_staff_pin: {
        Args: { _pin: string; _staff_id: string }
        Returns: undefined
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
      payment_method: "qr" | "cash" | "card"
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
      app_role: ["admin", "manager", "staff"],
      bill_status: ["open", "paid", "refunded", "partial_refund"],
      order_item_status: ["pending", "sent", "served", "voided"],
      order_source: ["pos", "qr", "takeout", "staff_meal"],
      order_status: ["open", "closed", "cancelled"],
      payment_method: ["qr", "cash", "card"],
      print_status: ["pending", "printed", "failed"],
      printer_kind: ["counter", "kitchen"],
      shift_status: ["open", "closed"],
      table_status: ["available", "occupied", "bill_requested"],
      vat_mode: ["inclusive", "exclusive"],
    },
  },
} as const
