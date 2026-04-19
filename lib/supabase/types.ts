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
      daily_guesses: {
        Row: {
          date: string
          display_name: string
          guess: string
          id: string
          player_id: string
          semantic_score: number
          style_score: number
          subject_score: number
          submitted_at: string
          total_score: number | null
        }
        Insert: {
          date: string
          display_name: string
          guess: string
          id?: string
          player_id: string
          semantic_score?: number
          style_score?: number
          subject_score?: number
          submitted_at?: string
          total_score?: number | null
        }
        Update: {
          date?: string
          display_name?: string
          guess?: string
          id?: string
          player_id?: string
          semantic_score?: number
          style_score?: number
          subject_score?: number
          submitted_at?: string
          total_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "daily_guesses_date_fkey"
            columns: ["date"]
            isOneToOne: false
            referencedRelation: "daily_prompts"
            referencedColumns: ["date"]
          },
          {
            foreignKeyName: "daily_guesses_date_fkey"
            columns: ["date"]
            isOneToOne: false
            referencedRelation: "daily_puzzle"
            referencedColumns: ["date"]
          },
        ]
      }
      daily_prompt_tokens: {
        Row: {
          date: string
          position: number
          role: Database["public"]["Enums"]["token_role"]
          token: string
        }
        Insert: {
          date: string
          position: number
          role: Database["public"]["Enums"]["token_role"]
          token: string
        }
        Update: {
          date?: string
          position?: number
          role?: Database["public"]["Enums"]["token_role"]
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_prompt_tokens_date_fkey"
            columns: ["date"]
            isOneToOne: false
            referencedRelation: "daily_prompts"
            referencedColumns: ["date"]
          },
          {
            foreignKeyName: "daily_prompt_tokens_date_fkey"
            columns: ["date"]
            isOneToOne: false
            referencedRelation: "daily_puzzle"
            referencedColumns: ["date"]
          },
        ]
      }
      daily_prompts: {
        Row: {
          created_at: string
          date: string
          image_storage_path: string | null
          image_url: string | null
          prompt: string
        }
        Insert: {
          created_at?: string
          date: string
          image_storage_path?: string | null
          image_url?: string | null
          prompt?: string
        }
        Update: {
          created_at?: string
          date?: string
          image_storage_path?: string | null
          image_url?: string | null
          prompt?: string
        }
        Relationships: []
      }
      guesses: {
        Row: {
          guess: string
          id: string
          player_id: string
          round_id: string
          scored_at: string | null
          semantic_score: number
          speed_bonus: number
          style_score: number
          subject_score: number
          submitted_at: string
          total_score: number | null
        }
        Insert: {
          guess: string
          id?: string
          player_id: string
          round_id: string
          scored_at?: string | null
          semantic_score?: number
          speed_bonus?: number
          style_score?: number
          subject_score?: number
          submitted_at?: string
          total_score?: number | null
        }
        Update: {
          guess?: string
          id?: string
          player_id?: string
          round_id?: string
          scored_at?: string | null
          semantic_score?: number
          speed_bonus?: number
          style_score?: number
          subject_score?: number
          submitted_at?: string
          total_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "guesses_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "guesses_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds_public"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name: string
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      room_messages: {
        Row: {
          content: string
          created_at: string
          display_name: string
          id: string
          player_id: string
          room_id: string
        }
        Insert: {
          content: string
          created_at?: string
          display_name: string
          id?: string
          player_id: string
          room_id: string
        }
        Update: {
          content?: string
          created_at?: string
          display_name?: string
          id?: string
          player_id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "room_messages_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      room_players: {
        Row: {
          display_name: string
          is_host: boolean
          is_spectator: boolean
          joined_at: string
          last_seen_at: string
          player_id: string
          room_id: string
          score: number
        }
        Insert: {
          display_name: string
          is_host?: boolean
          is_spectator?: boolean
          joined_at?: string
          last_seen_at?: string
          player_id: string
          room_id: string
          score?: number
        }
        Update: {
          display_name?: string
          is_host?: boolean
          is_spectator?: boolean
          joined_at?: string
          last_seen_at?: string
          player_id?: string
          room_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "room_players_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          code: string
          created_at: string
          guess_seconds: number
          host_id: string
          id: string
          max_rounds: number
          mode: Database["public"]["Enums"]["room_mode"]
          pack: Database["public"]["Enums"]["room_pack"]
          phase: Database["public"]["Enums"]["room_phase"]
          phase_ends_at: string | null
          reveal_seconds: number
          round_num: number
        }
        Insert: {
          code: string
          created_at?: string
          guess_seconds?: number
          host_id: string
          id?: string
          max_rounds?: number
          mode?: Database["public"]["Enums"]["room_mode"]
          pack?: Database["public"]["Enums"]["room_pack"]
          phase?: Database["public"]["Enums"]["room_phase"]
          phase_ends_at?: string | null
          reveal_seconds?: number
          round_num?: number
        }
        Update: {
          code?: string
          created_at?: string
          guess_seconds?: number
          host_id?: string
          id?: string
          max_rounds?: number
          mode?: Database["public"]["Enums"]["room_mode"]
          pack?: Database["public"]["Enums"]["room_pack"]
          phase?: Database["public"]["Enums"]["room_phase"]
          phase_ends_at?: string | null
          reveal_seconds?: number
          round_num?: number
        }
        Relationships: []
      }
      round_prompt_tokens: {
        Row: {
          position: number
          role: Database["public"]["Enums"]["token_role"]
          round_id: string
          token: string
        }
        Insert: {
          position: number
          role: Database["public"]["Enums"]["token_role"]
          round_id: string
          token: string
        }
        Update: {
          position?: number
          role?: Database["public"]["Enums"]["token_role"]
          round_id?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "round_prompt_tokens_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "round_prompt_tokens_round_id_fkey"
            columns: ["round_id"]
            isOneToOne: false
            referencedRelation: "rounds_public"
            referencedColumns: ["id"]
          },
        ]
      }
      rounds: {
        Row: {
          artist_player_id: string | null
          ended_at: string | null
          id: string
          image_storage_path: string | null
          image_url: string | null
          prompt: string
          room_id: string
          round_num: number
          started_at: string
        }
        Insert: {
          artist_player_id?: string | null
          ended_at?: string | null
          id?: string
          image_storage_path?: string | null
          image_url?: string | null
          prompt?: string
          room_id: string
          round_num: number
          started_at?: string
        }
        Update: {
          artist_player_id?: string | null
          ended_at?: string | null
          id?: string
          image_storage_path?: string | null
          image_url?: string | null
          prompt?: string
          room_id?: string
          round_num?: number
          started_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "rounds_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      daily_puzzle: {
        Row: {
          created_at: string | null
          date: string | null
          image_url: string | null
        }
        Insert: {
          created_at?: string | null
          date?: string | null
          image_url?: string | null
        }
        Update: {
          created_at?: string | null
          date?: string | null
          image_url?: string | null
        }
        Relationships: []
      }
      rounds_public: {
        Row: {
          artist_player_id: string | null
          ended_at: string | null
          id: string | null
          image_storage_path: string | null
          image_url: string | null
          prompt: string | null
          room_id: string | null
          round_num: number | null
          started_at: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rounds_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      count_round_guesses: { Args: { p_round_id: string }; Returns: number }
      create_room: {
        Args: {
          p_display_name: string
          p_guess_seconds?: number
          p_max_rounds?: number
          p_mode?: Database["public"]["Enums"]["room_mode"]
          p_pack?: Database["public"]["Enums"]["room_pack"]
          p_reveal_seconds?: number
        }
        Returns: {
          new_code: string
          new_room_id: string
        }[]
      }
      everyone_guessed: { Args: { p_round_id: string }; Returns: boolean }
      generate_room_code: { Args: never; Returns: string }
      is_room_member: { Args: { p_room_id: string }; Returns: boolean }
      join_room_by_code: {
        Args: {
          p_as_spectator?: boolean
          p_code: string
          p_display_name: string
        }
        Returns: string
      }
      kick_player: {
        Args: { p_room_id: string; p_victim_id: string }
        Returns: undefined
      }
      leave_room: { Args: { p_room_id: string }; Returns: undefined }
      play_again: {
        Args: {
          p_guess_seconds?: number
          p_max_rounds?: number
          p_reveal_seconds?: number
          p_room_id: string
        }
        Returns: undefined
      }
      post_message: {
        Args: { p_content: string; p_room_id: string }
        Returns: string
      }
      realtime_topic_room: { Args: { topic: string }; Returns: string }
      start_round: { Args: { p_room_id: string }; Returns: string }
      submit_artist_prompt: {
        Args: { p_prompt: string; p_round_id: string }
        Returns: undefined
      }
      submit_guess: {
        Args: { p_guess: string; p_round_id: string }
        Returns: string
      }
      transfer_host: {
        Args: { p_new_host_id: string; p_room_id: string }
        Returns: undefined
      }
    }
    Enums: {
      room_mode: "party" | "teams" | "headsup" | "artist"
      room_pack: "mixed" | "food" | "wildlife" | "history" | "absurd"
      room_phase:
        | "lobby"
        | "generating"
        | "guessing"
        | "scoring"
        | "reveal"
        | "game_over"
        | "prompting"
      token_role: "subject" | "style" | "modifier" | "filler"
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
      room_mode: ["party", "teams", "headsup", "artist"],
      room_pack: ["mixed", "food", "wildlife", "history", "absurd"],
      room_phase: [
        "lobby",
        "generating",
        "guessing",
        "scoring",
        "reveal",
        "game_over",
        "prompting",
      ],
      token_role: ["subject", "style", "modifier", "filler"],
    },
  },
} as const
