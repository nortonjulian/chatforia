--
-- PostgreSQL database dump
--

\restrict PqY61XefKv7FTj5hip0VqV5z5yNvugODPAaljhdBL6SzeZDKgj4ri5UP3hYIegy

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: A11YBg; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."A11YBg" AS ENUM (
    'light',
    'dark',
    'transparent'
);


ALTER TYPE public."A11YBg" OWNER TO doadmin;

--
-- Name: A11YFont; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."A11YFont" AS ENUM (
    'sm',
    'md',
    'lg',
    'xl'
);


ALTER TYPE public."A11YFont" OWNER TO doadmin;

--
-- Name: AIAssistantMode; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."AIAssistantMode" AS ENUM (
    'OFF',
    'MENTION',
    'ALWAYS'
);


ALTER TYPE public."AIAssistantMode" OWNER TO doadmin;

--
-- Name: AgeBand; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."AgeBand" AS ENUM (
    'TEEN_13_17',
    'ADULT_18_24',
    'ADULT_25_34',
    'ADULT_35_49',
    'ADULT_50_PLUS'
);


ALTER TYPE public."AgeBand" OWNER TO doadmin;

--
-- Name: AttachmentKind; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."AttachmentKind" AS ENUM (
    'IMAGE',
    'VIDEO',
    'AUDIO',
    'FILE',
    'STICKER',
    'GIF'
);


ALTER TYPE public."AttachmentKind" OWNER TO doadmin;

--
-- Name: AutoResponderMode; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."AutoResponderMode" AS ENUM (
    'OFF',
    'DM',
    'MENTION',
    'ALL'
);


ALTER TYPE public."AutoResponderMode" OWNER TO doadmin;

--
-- Name: AutoTranslateMode; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."AutoTranslateMode" AS ENUM (
    'OFF',
    'TAGGED',
    'ALL'
);


ALTER TYPE public."AutoTranslateMode" OWNER TO doadmin;

--
-- Name: CallMode; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."CallMode" AS ENUM (
    'AUDIO',
    'VIDEO'
);


ALTER TYPE public."CallMode" OWNER TO doadmin;

--
-- Name: CallStatus; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."CallStatus" AS ENUM (
    'INITIATED',
    'RINGING',
    'ACTIVE',
    'DECLINED',
    'MISSED',
    'FAILED',
    'ENDED'
);


ALTER TYPE public."CallStatus" OWNER TO doadmin;

--
-- Name: ContentScope; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."ContentScope" AS ENUM (
    'COMMANDS',
    'MENTIONS',
    'ALL'
);


ALTER TYPE public."ContentScope" OWNER TO doadmin;

--
-- Name: FamilyInviteStatus; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."FamilyInviteStatus" AS ENUM (
    'PENDING',
    'ACCEPTED',
    'EXPIRED',
    'CANCELLED'
);


ALTER TYPE public."FamilyInviteStatus" OWNER TO doadmin;

--
-- Name: FamilyRole; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."FamilyRole" AS ENUM (
    'OWNER',
    'MEMBER'
);


ALTER TYPE public."FamilyRole" OWNER TO doadmin;

--
-- Name: NumberStatus; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."NumberStatus" AS ENUM (
    'AVAILABLE',
    'RESERVED',
    'ASSIGNED',
    'HOLD',
    'RELEASING',
    'RELEASED'
);


ALTER TYPE public."NumberStatus" OWNER TO doadmin;

--
-- Name: PhoneNumberSource; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."PhoneNumberSource" AS ENUM (
    'PROVISIONED',
    'PORTED'
);


ALTER TYPE public."PhoneNumberSource" OWNER TO doadmin;

--
-- Name: Plan; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."Plan" AS ENUM (
    'FREE',
    'PREMIUM',
    'PLUS',
    'WIRELESS'
);


ALTER TYPE public."Plan" OWNER TO doadmin;

--
-- Name: PortStatus; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."PortStatus" AS ENUM (
    'NONE',
    'PORT_IN_PENDING',
    'PORTED_IN',
    'PORT_OUT_PENDING',
    'PORTED_OUT'
);


ALTER TYPE public."PortStatus" OWNER TO doadmin;

--
-- Name: RegionTier; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."RegionTier" AS ENUM (
    'T1',
    'T2',
    'T3',
    'T4',
    'ROW'
);


ALTER TYPE public."RegionTier" OWNER TO doadmin;

--
-- Name: RoomRole; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."RoomRole" AS ENUM (
    'MEMBER',
    'MODERATOR',
    'ADMIN'
);


ALTER TYPE public."RoomRole" OWNER TO doadmin;

--
-- Name: StatusAssetKind; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."StatusAssetKind" AS ENUM (
    'IMAGE',
    'VIDEO',
    'AUDIO',
    'GIF',
    'STICKER',
    'FILE'
);


ALTER TYPE public."StatusAssetKind" OWNER TO doadmin;

--
-- Name: StatusAudience; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."StatusAudience" AS ENUM (
    'CONTACTS',
    'MUTUALS',
    'CUSTOM',
    'EVERYONE'
);


ALTER TYPE public."StatusAudience" OWNER TO doadmin;

--
-- Name: SubscriberStatus; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."SubscriberStatus" AS ENUM (
    'PENDING',
    'PROVISIONING',
    'ACTIVE',
    'SUSPENDED',
    'CANCELLED',
    'PORTING'
);


ALTER TYPE public."SubscriberStatus" OWNER TO doadmin;

--
-- Name: VerificationType; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."VerificationType" AS ENUM (
    'EMAIL',
    'PHONE',
    'MFA_LOGIN'
);


ALTER TYPE public."VerificationType" OWNER TO doadmin;

--
-- Name: VoicemailTranscriptStatus; Type: TYPE; Schema: public; Owner: doadmin
--

CREATE TYPE public."VoicemailTranscriptStatus" AS ENUM (
    'PENDING',
    'COMPLETE',
    'FAILED'
);


ALTER TYPE public."VoicemailTranscriptStatus" OWNER TO doadmin;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: AdInquiry; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."AdInquiry" (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    company text,
    budget text,
    message text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."AdInquiry" OWNER TO doadmin;

--
-- Name: AdInquiry_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."AdInquiry_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."AdInquiry_id_seq" OWNER TO doadmin;

--
-- Name: AdInquiry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."AdInquiry_id_seq" OWNED BY public."AdInquiry".id;


--
-- Name: AuditLog; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."AuditLog" (
    id integer NOT NULL,
    "actorId" integer NOT NULL,
    action text NOT NULL,
    resource text,
    "resourceId" text,
    status integer NOT NULL,
    ip text,
    "userAgent" text,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."AuditLog" OWNER TO doadmin;

--
-- Name: AuditLog_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."AuditLog_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."AuditLog_id_seq" OWNER TO doadmin;

--
-- Name: AuditLog_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."AuditLog_id_seq" OWNED BY public."AuditLog".id;


--
-- Name: Bot; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Bot" (
    id integer NOT NULL,
    "ownerId" integer NOT NULL,
    name text NOT NULL,
    url text NOT NULL,
    secret text NOT NULL,
    "serviceUserId" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Bot" OWNER TO doadmin;

--
-- Name: BotEventLog; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."BotEventLog" (
    id integer NOT NULL,
    "installId" integer NOT NULL,
    "eventId" text NOT NULL,
    type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    "nextAttemptAt" timestamp(3) without time zone,
    "lastError" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."BotEventLog" OWNER TO doadmin;

--
-- Name: BotEventLog_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."BotEventLog_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."BotEventLog_id_seq" OWNER TO doadmin;

--
-- Name: BotEventLog_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."BotEventLog_id_seq" OWNED BY public."BotEventLog".id;


--
-- Name: BotInstall; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."BotInstall" (
    id integer NOT NULL,
    "botId" integer NOT NULL,
    "chatRoomId" integer NOT NULL,
    "contentScope" public."ContentScope" DEFAULT 'COMMANDS'::public."ContentScope" NOT NULL,
    "isEnabled" boolean DEFAULT true NOT NULL,
    scopes text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."BotInstall" OWNER TO doadmin;

--
-- Name: BotInstall_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."BotInstall_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."BotInstall_id_seq" OWNER TO doadmin;

--
-- Name: BotInstall_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."BotInstall_id_seq" OWNED BY public."BotInstall".id;


--
-- Name: Bot_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."Bot_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Bot_id_seq" OWNER TO doadmin;

--
-- Name: Bot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."Bot_id_seq" OWNED BY public."Bot".id;


--
-- Name: Call; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Call" (
    "callerId" integer NOT NULL,
    "calleeId" integer NOT NULL,
    mode public."CallMode" NOT NULL,
    status public."CallStatus" DEFAULT 'RINGING'::public."CallStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "endedAt" timestamp(3) without time zone,
    "answerSdp" text,
    "offerSdp" text,
    "roomId" integer,
    "startedAt" timestamp(3) without time zone,
    id integer NOT NULL
);


ALTER TABLE public."Call" OWNER TO doadmin;

--
-- Name: Call_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."Call_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Call_id_seq" OWNER TO doadmin;

--
-- Name: Call_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."Call_id_seq" OWNED BY public."Call".id;


--
-- Name: ChatRoom; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."ChatRoom" (
    id integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "isGroup" boolean DEFAULT false NOT NULL,
    name text,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "autoTranslateMode" public."AutoTranslateMode" DEFAULT 'OFF'::public."AutoTranslateMode" NOT NULL,
    "aiAssistantMode" public."AIAssistantMode" DEFAULT 'OFF'::public."AIAssistantMode" NOT NULL,
    "allowForiaBot" boolean DEFAULT false NOT NULL,
    "ownerId" integer
);


ALTER TABLE public."ChatRoom" OWNER TO doadmin;

--
-- Name: ChatRoomInvite; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."ChatRoomInvite" (
    id integer NOT NULL,
    code text NOT NULL,
    "chatRoomId" integer NOT NULL,
    "createdById" integer NOT NULL,
    "maxUses" integer DEFAULT 0 NOT NULL,
    uses integer DEFAULT 0 NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ChatRoomInvite" OWNER TO doadmin;

--
-- Name: ChatRoomInvite_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."ChatRoomInvite_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."ChatRoomInvite_id_seq" OWNER TO doadmin;

--
-- Name: ChatRoomInvite_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."ChatRoomInvite_id_seq" OWNED BY public."ChatRoomInvite".id;


--
-- Name: ChatRoom_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."ChatRoom_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."ChatRoom_id_seq" OWNER TO doadmin;

--
-- Name: ChatRoom_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."ChatRoom_id_seq" OWNED BY public."ChatRoom".id;


--
-- Name: Contact; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Contact" (
    id integer NOT NULL,
    "ownerId" integer NOT NULL,
    "userId" integer,
    alias text,
    favorite boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "externalName" text,
    "externalPhone" text,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Contact" OWNER TO doadmin;

--
-- Name: Contact_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."Contact_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Contact_id_seq" OWNER TO doadmin;

--
-- Name: Contact_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."Contact_id_seq" OWNED BY public."Contact".id;


--
-- Name: Device; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Device" (
    id text NOT NULL,
    "userId" integer NOT NULL,
    "publicKey" text NOT NULL,
    name text,
    platform text,
    "isPrimary" boolean DEFAULT false NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "lastSeenAt" timestamp(3) without time zone,
    "revokedAt" timestamp(3) without time zone,
    "revokedById" integer,
    "deviceId" text NOT NULL,
    "keyAlgorithm" text DEFAULT 'curve25519'::text NOT NULL,
    "keyVersion" integer DEFAULT 1 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "pairingApprovedAt" timestamp(3) without time zone,
    "pairingRejectedAt" timestamp(3) without time zone,
    "pairingRequestedAt" timestamp(3) without time zone,
    "pairingStatus" text,
    "wrappedAccountKey" text,
    "wrappedAccountKeyAlgo" text,
    "wrappedAccountKeyVer" integer
);


ALTER TABLE public."Device" OWNER TO doadmin;

--
-- Name: FamilyGroup; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."FamilyGroup" (
    id integer NOT NULL,
    "ownerId" integer NOT NULL,
    name text DEFAULT 'My Chatforia Family'::text NOT NULL,
    "totalDataMb" integer DEFAULT 0 NOT NULL,
    "usedDataMb" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."FamilyGroup" OWNER TO doadmin;

--
-- Name: FamilyGroup_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."FamilyGroup_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."FamilyGroup_id_seq" OWNER TO doadmin;

--
-- Name: FamilyGroup_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."FamilyGroup_id_seq" OWNED BY public."FamilyGroup".id;


--
-- Name: FamilyInvite; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."FamilyInvite" (
    id integer NOT NULL,
    "groupId" integer NOT NULL,
    email text,
    phone text,
    token text NOT NULL,
    status public."FamilyInviteStatus" DEFAULT 'PENDING'::public."FamilyInviteStatus" NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "acceptedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."FamilyInvite" OWNER TO doadmin;

--
-- Name: FamilyInvite_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."FamilyInvite_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."FamilyInvite_id_seq" OWNER TO doadmin;

--
-- Name: FamilyInvite_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."FamilyInvite_id_seq" OWNED BY public."FamilyInvite".id;


--
-- Name: FamilyMember; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."FamilyMember" (
    id integer NOT NULL,
    "groupId" integer NOT NULL,
    "userId" integer NOT NULL,
    role public."FamilyRole" DEFAULT 'MEMBER'::public."FamilyRole" NOT NULL,
    "limitDataMb" integer,
    "usedDataMb" integer DEFAULT 0 NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."FamilyMember" OWNER TO doadmin;

--
-- Name: FamilyMember_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."FamilyMember_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."FamilyMember_id_seq" OWNER TO doadmin;

--
-- Name: FamilyMember_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."FamilyMember_id_seq" OWNED BY public."FamilyMember".id;


--
-- Name: Follow; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Follow" (
    id integer NOT NULL,
    "followerId" integer NOT NULL,
    "followingId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Follow" OWNER TO doadmin;

--
-- Name: Follow_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."Follow_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Follow_id_seq" OWNER TO doadmin;

--
-- Name: Follow_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."Follow_id_seq" OWNED BY public."Follow".id;


--
-- Name: ForiaMessage; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."ForiaMessage" (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ForiaMessage" OWNER TO doadmin;

--
-- Name: ForiaMessage_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."ForiaMessage_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."ForiaMessage_id_seq" OWNER TO doadmin;

--
-- Name: ForiaMessage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."ForiaMessage_id_seq" OWNED BY public."ForiaMessage".id;


--
-- Name: Language; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Language" (
    id integer NOT NULL,
    code text NOT NULL,
    "displayName" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Language" OWNER TO doadmin;

--
-- Name: Language_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."Language_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Language_id_seq" OWNER TO doadmin;

--
-- Name: Language_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."Language_id_seq" OWNED BY public."Language".id;


--
-- Name: Message; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Message" (
    id integer NOT NULL,
    "senderId" integer NOT NULL,
    "chatRoomId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "imageUrl" text,
    "translatedFrom" text,
    "isExplicit" boolean DEFAULT false NOT NULL,
    "rawContent" text,
    "randomChatRoomId" integer,
    "deletedBySender" boolean DEFAULT false NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    translations jsonb,
    "isAutoReply" boolean DEFAULT false NOT NULL,
    "audioDurationSec" integer,
    "audioUrl" text,
    "translatedContent" text,
    "translatedTo" text,
    "contentCiphertext" jsonb,
    "deletedAt" timestamp(3) without time zone,
    "deletedById" integer,
    "deletedForAll" boolean DEFAULT false NOT NULL,
    "clientMessageId" text,
    "editedAt" timestamp(3) without time zone,
    revision integer DEFAULT 1 NOT NULL,
    "isHiddenByModeration" boolean DEFAULT false NOT NULL,
    "moderationStatus" text
);


ALTER TABLE public."Message" OWNER TO doadmin;

--
-- Name: MessageAttachment; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."MessageAttachment" (
    id integer NOT NULL,
    "messageId" integer NOT NULL,
    kind public."AttachmentKind" NOT NULL,
    url text NOT NULL,
    "mimeType" text NOT NULL,
    width integer,
    height integer,
    "durationSec" integer,
    caption text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "fileSize" integer,
    waveform jsonb,
    "thumbUrl" text,
    "deletedAt" timestamp(3) without time zone
);


ALTER TABLE public."MessageAttachment" OWNER TO doadmin;

--
-- Name: MessageAttachment_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."MessageAttachment_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."MessageAttachment_id_seq" OWNER TO doadmin;

--
-- Name: MessageAttachment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."MessageAttachment_id_seq" OWNED BY public."MessageAttachment".id;


--
-- Name: MessageDeletion; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."MessageDeletion" (
    id integer NOT NULL,
    "messageId" integer NOT NULL,
    "userId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."MessageDeletion" OWNER TO doadmin;

--
-- Name: MessageDeletion_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."MessageDeletion_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."MessageDeletion_id_seq" OWNER TO doadmin;

--
-- Name: MessageDeletion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."MessageDeletion_id_seq" OWNED BY public."MessageDeletion".id;


--
-- Name: MessageKey; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."MessageKey" (
    "messageId" integer NOT NULL,
    "userId" integer NOT NULL,
    "encryptedKey" text NOT NULL
);


ALTER TABLE public."MessageKey" OWNER TO doadmin;

--
-- Name: MessageReaction; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."MessageReaction" (
    "messageId" integer NOT NULL,
    "userId" integer NOT NULL,
    emoji text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."MessageReaction" OWNER TO doadmin;

--
-- Name: MessageRead; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."MessageRead" (
    "messageId" integer NOT NULL,
    "userId" integer NOT NULL,
    "readAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."MessageRead" OWNER TO doadmin;

--
-- Name: MessageSessionKey; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."MessageSessionKey" (
    id text NOT NULL,
    "recipientDeviceId" text NOT NULL,
    "encryptedSessionKey" text NOT NULL,
    "messageId" integer NOT NULL,
    "recipientUserId" integer NOT NULL
);


ALTER TABLE public."MessageSessionKey" OWNER TO doadmin;

--
-- Name: Message_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."Message_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Message_id_seq" OWNER TO doadmin;

--
-- Name: Message_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."Message_id_seq" OWNED BY public."Message".id;


--
-- Name: MobileDataPackPurchase; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."MobileDataPackPurchase" (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "expiresAt" timestamp(3) without time zone,
    "purchasedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "addonKind" text NOT NULL,
    kind text NOT NULL,
    "provisioningError" text,
    "qrCodeSvg" text,
    "remainingDataMb" integer NOT NULL,
    "stripeCheckoutSessionId" text,
    "stripePaymentIntentId" text,
    "tealProfileId" text,
    "totalDataMb" integer NOT NULL,
    iccid text
);


ALTER TABLE public."MobileDataPackPurchase" OWNER TO doadmin;

--
-- Name: MobileDataPackPurchase_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."MobileDataPackPurchase_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."MobileDataPackPurchase_id_seq" OWNER TO doadmin;

--
-- Name: MobileDataPackPurchase_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."MobileDataPackPurchase_id_seq" OWNED BY public."MobileDataPackPurchase".id;


--
-- Name: NumberReservation; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."NumberReservation" (
    id integer NOT NULL,
    "phoneNumberId" integer NOT NULL,
    "userId" integer NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."NumberReservation" OWNER TO doadmin;

--
-- Name: NumberReservation_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."NumberReservation_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."NumberReservation_id_seq" OWNER TO doadmin;

--
-- Name: NumberReservation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."NumberReservation_id_seq" OWNED BY public."NumberReservation".id;


--
-- Name: Participant; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Participant" (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "chatRoomId" integer NOT NULL,
    "joinedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "allowAIBot" boolean DEFAULT true NOT NULL,
    role public."RoomRole" DEFAULT 'MEMBER'::public."RoomRole" NOT NULL,
    "archivedAt" timestamp(3) without time zone,
    "clearedAt" timestamp(3) without time zone
);


ALTER TABLE public."Participant" OWNER TO doadmin;

--
-- Name: Participant_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."Participant_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Participant_id_seq" OWNER TO doadmin;

--
-- Name: Participant_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."Participant_id_seq" OWNED BY public."Participant".id;


--
-- Name: PasswordResetToken; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."PasswordResetToken" (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "usedAt" timestamp(3) without time zone,
    "tokenHash" character varying(64) NOT NULL
);


ALTER TABLE public."PasswordResetToken" OWNER TO doadmin;

--
-- Name: PasswordResetToken_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."PasswordResetToken_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."PasswordResetToken_id_seq" OWNER TO doadmin;

--
-- Name: PasswordResetToken_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."PasswordResetToken_id_seq" OWNED BY public."PasswordResetToken".id;


--
-- Name: PeopleInvite; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."PeopleInvite" (
    id integer NOT NULL,
    code text NOT NULL,
    "inviterUserId" integer NOT NULL,
    "targetPhone" text,
    "targetEmail" text,
    channel text DEFAULT 'share_link'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    "acceptedByUserId" integer,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "expiresAt" timestamp(3) without time zone
);


ALTER TABLE public."PeopleInvite" OWNER TO doadmin;

--
-- Name: PeopleInvite_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."PeopleInvite_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."PeopleInvite_id_seq" OWNER TO doadmin;

--
-- Name: PeopleInvite_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."PeopleInvite_id_seq" OWNED BY public."PeopleInvite".id;


--
-- Name: Phone; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Phone" (
    id integer NOT NULL,
    number text NOT NULL,
    "userId" integer,
    "optedOut" boolean DEFAULT false NOT NULL,
    "optedOutAt" timestamp(3) without time zone,
    "verifiedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Phone" OWNER TO doadmin;

--
-- Name: PhoneNumber; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."PhoneNumber" (
    id integer NOT NULL,
    e164 text NOT NULL,
    provider text DEFAULT 'twilio'::text NOT NULL,
    "areaCode" text,
    vanity boolean DEFAULT false NOT NULL,
    status public."NumberStatus" DEFAULT 'AVAILABLE'::public."NumberStatus" NOT NULL,
    "assignedUserId" integer,
    "assignedAt" timestamp(3) without time zone,
    "lastOutboundAt" timestamp(3) without time zone,
    "keepLocked" boolean DEFAULT false NOT NULL,
    "holdUntil" timestamp(3) without time zone,
    "releaseAfter" timestamp(3) without time zone,
    "portStatus" public."PortStatus" DEFAULT 'NONE'::public."PortStatus" NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    source public."PhoneNumberSource" DEFAULT 'PROVISIONED'::public."PhoneNumberSource" NOT NULL,
    "twilioSid" text,
    capabilities jsonb,
    "isoCountry" character varying(2),
    "forSale" boolean DEFAULT false NOT NULL
);


ALTER TABLE public."PhoneNumber" OWNER TO doadmin;

--
-- Name: PhoneNumber_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."PhoneNumber_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."PhoneNumber_id_seq" OWNER TO doadmin;

--
-- Name: PhoneNumber_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."PhoneNumber_id_seq" OWNED BY public."PhoneNumber".id;


--
-- Name: PhoneOtp; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."PhoneOtp" (
    id integer NOT NULL,
    phone text NOT NULL,
    "otpCode" text NOT NULL,
    "providerMessageId" text,
    attempts integer DEFAULT 0 NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."PhoneOtp" OWNER TO doadmin;

--
-- Name: PhoneOtp_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."PhoneOtp_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."PhoneOtp_id_seq" OWNER TO doadmin;

--
-- Name: PhoneOtp_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."PhoneOtp_id_seq" OWNED BY public."PhoneOtp".id;


--
-- Name: PhoneVerificationRequest; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."PhoneVerificationRequest" (
    id integer NOT NULL,
    "phoneNumber" text NOT NULL,
    "verificationCode" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "consentedAt" timestamp(3) without time zone NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    intent text,
    "verifiedAt" timestamp(3) without time zone,
    "consumedAt" timestamp(3) without time zone,
    "phoneVerificationId" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "phoneId" integer
);


ALTER TABLE public."PhoneVerificationRequest" OWNER TO doadmin;

--
-- Name: PhoneVerificationRequest_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."PhoneVerificationRequest_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."PhoneVerificationRequest_id_seq" OWNER TO doadmin;

--
-- Name: PhoneVerificationRequest_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."PhoneVerificationRequest_id_seq" OWNED BY public."PhoneVerificationRequest".id;


--
-- Name: Phone_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."Phone_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Phone_id_seq" OWNER TO doadmin;

--
-- Name: Phone_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."Phone_id_seq" OWNED BY public."Phone".id;


--
-- Name: PortRequest; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."PortRequest" (
    id text NOT NULL,
    "userId" integer NOT NULL,
    "phoneNumber" text NOT NULL,
    "externalPortId" text,
    carrier text,
    "accountNumber" text,
    pin text,
    "fullName" text NOT NULL,
    "addressLine1" text NOT NULL,
    "addressLine2" text,
    city text NOT NULL,
    state text NOT NULL,
    "postalCode" text NOT NULL,
    country text DEFAULT 'US'::text NOT NULL,
    status public."PortStatus" DEFAULT 'NONE'::public."PortStatus" NOT NULL,
    "statusReason" text,
    "scheduledAt" timestamp(3) without time zone,
    "completedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."PortRequest" OWNER TO doadmin;

--
-- Name: Price; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Price" (
    id text NOT NULL,
    product character varying(64) NOT NULL,
    tier public."RegionTier" NOT NULL,
    currency character varying(8) NOT NULL,
    "unitAmount" integer NOT NULL,
    "stripePriceId" text,
    "appleSku" text,
    "googleSku" text,
    active boolean DEFAULT true NOT NULL
);


ALTER TABLE public."Price" OWNER TO doadmin;

--
-- Name: PriceOverride; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."PriceOverride" (
    id text NOT NULL,
    "countryCode" text NOT NULL,
    plan public."Plan" NOT NULL,
    currency text NOT NULL,
    "priceCents" integer NOT NULL,
    "stripePriceId" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."PriceOverride" OWNER TO doadmin;

--
-- Name: ProvisionLink; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."ProvisionLink" (
    id text NOT NULL,
    secret text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "usedAt" timestamp(3) without time zone,
    "sasCode" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "userId" integer NOT NULL,
    "createdById" integer
);


ALTER TABLE public."ProvisionLink" OWNER TO doadmin;

--
-- Name: RandomChatRoom; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."RandomChatRoom" (
    id integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "aiEnabled" boolean DEFAULT false NOT NULL
);


ALTER TABLE public."RandomChatRoom" OWNER TO doadmin;

--
-- Name: RandomChatRoom_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."RandomChatRoom_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."RandomChatRoom_id_seq" OWNER TO doadmin;

--
-- Name: RandomChatRoom_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."RandomChatRoom_id_seq" OWNED BY public."RandomChatRoom".id;


--
-- Name: RegionRule; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."RegionRule" (
    id text NOT NULL,
    "countryCode" character varying(2) NOT NULL,
    tier public."RegionTier" NOT NULL
);


ALTER TABLE public."RegionRule" OWNER TO doadmin;

--
-- Name: Report; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Report" (
    id integer NOT NULL,
    "messageId" integer NOT NULL,
    "reporterId" integer NOT NULL,
    "decryptedContent" text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    notes text,
    "resolvedAt" timestamp(3) without time zone,
    status text DEFAULT 'OPEN'::text NOT NULL,
    "blockApplied" boolean DEFAULT false NOT NULL,
    "chatRoomId" integer,
    details text,
    evidence jsonb,
    reason text,
    "reportedUserId" integer,
    "aiCategory" text,
    "aiSummary" text,
    "autoHidden" boolean DEFAULT false NOT NULL,
    priority text,
    "recommendedAction" text,
    "reviewedByAiAt" timestamp(3) without time zone,
    "scoreFactors" jsonb,
    "severityScore" double precision
);


ALTER TABLE public."Report" OWNER TO doadmin;

--
-- Name: Report_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."Report_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Report_id_seq" OWNER TO doadmin;

--
-- Name: Report_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."Report_id_seq" OWNED BY public."Report".id;


--
-- Name: STTUsage; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."STTUsage" (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "monthKey" text NOT NULL,
    seconds integer DEFAULT 0 NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."STTUsage" OWNER TO doadmin;

--
-- Name: STTUsage_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."STTUsage_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."STTUsage_id_seq" OWNER TO doadmin;

--
-- Name: STTUsage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."STTUsage_id_seq" OWNED BY public."STTUsage".id;


--
-- Name: ScheduledMessage; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."ScheduledMessage" (
    id integer NOT NULL,
    "chatRoomId" integer NOT NULL,
    "senderId" integer NOT NULL,
    content text NOT NULL,
    "scheduledAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."ScheduledMessage" OWNER TO doadmin;

--
-- Name: ScheduledMessage_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."ScheduledMessage_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."ScheduledMessage_id_seq" OWNER TO doadmin;

--
-- Name: ScheduledMessage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."ScheduledMessage_id_seq" OWNED BY public."ScheduledMessage".id;


--
-- Name: SmsCarrierEvent; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."SmsCarrierEvent" (
    id integer NOT NULL,
    "from" text NOT NULL,
    "to" text NOT NULL,
    body text NOT NULL,
    direction text NOT NULL,
    action text,
    metadata jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."SmsCarrierEvent" OWNER TO doadmin;

--
-- Name: SmsCarrierEvent_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."SmsCarrierEvent_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."SmsCarrierEvent_id_seq" OWNER TO doadmin;

--
-- Name: SmsCarrierEvent_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."SmsCarrierEvent_id_seq" OWNED BY public."SmsCarrierEvent".id;


--
-- Name: SmsConsent; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."SmsConsent" (
    id integer NOT NULL,
    phone text NOT NULL,
    "pendingRegistration" jsonb,
    "consentTextVersion" text NOT NULL,
    "ipAddress" text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."SmsConsent" OWNER TO doadmin;

--
-- Name: SmsConsent_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."SmsConsent_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."SmsConsent_id_seq" OWNER TO doadmin;

--
-- Name: SmsConsent_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."SmsConsent_id_seq" OWNED BY public."SmsConsent".id;


--
-- Name: SmsMessage; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."SmsMessage" (
    id integer NOT NULL,
    "threadId" integer NOT NULL,
    direction text NOT NULL,
    "fromNumber" character varying(32) NOT NULL,
    "toNumber" character varying(32) NOT NULL,
    body text NOT NULL,
    provider text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "mediaUrls" jsonb,
    "providerMessageId" character varying(128),
    "editedAt" timestamp(3) without time zone,
    "phoneId" integer
);


ALTER TABLE public."SmsMessage" OWNER TO doadmin;

--
-- Name: SmsMessage_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."SmsMessage_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."SmsMessage_id_seq" OWNER TO doadmin;

--
-- Name: SmsMessage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."SmsMessage_id_seq" OWNED BY public."SmsMessage".id;


--
-- Name: SmsOptOut; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."SmsOptOut" (
    id integer NOT NULL,
    phone text NOT NULL,
    provider text,
    reason text,
    "inboundMessageId" text,
    "rawPayload" jsonb,
    "ipAddress" text,
    "userAgent" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."SmsOptOut" OWNER TO doadmin;

--
-- Name: SmsOptOut_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."SmsOptOut_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."SmsOptOut_id_seq" OWNER TO doadmin;

--
-- Name: SmsOptOut_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."SmsOptOut_id_seq" OWNED BY public."SmsOptOut".id;


--
-- Name: SmsParticipant; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."SmsParticipant" (
    id integer NOT NULL,
    "threadId" integer NOT NULL,
    phone character varying(32) NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."SmsParticipant" OWNER TO doadmin;

--
-- Name: SmsParticipant_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."SmsParticipant_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."SmsParticipant_id_seq" OWNER TO doadmin;

--
-- Name: SmsParticipant_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."SmsParticipant_id_seq" OWNED BY public."SmsParticipant".id;


--
-- Name: SmsThread; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."SmsThread" (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL,
    "archivedAt" timestamp(3) without time zone,
    "contactId" integer,
    "contactPhone" character varying(32),
    "deletedAt" timestamp(3) without time zone
);


ALTER TABLE public."SmsThread" OWNER TO doadmin;

--
-- Name: SmsThread_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."SmsThread_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."SmsThread_id_seq" OWNER TO doadmin;

--
-- Name: SmsThread_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."SmsThread_id_seq" OWNED BY public."SmsThread".id;


--
-- Name: Status; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Status" (
    id integer NOT NULL,
    "authorId" integer NOT NULL,
    "captionCiphertext" text,
    "encryptedKeys" jsonb,
    "translatedFrom" text,
    translations jsonb,
    "isExplicit" boolean DEFAULT false NOT NULL,
    audience public."StatusAudience" DEFAULT 'MUTUALS'::public."StatusAudience" NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Status" OWNER TO doadmin;

--
-- Name: StatusAsset; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."StatusAsset" (
    id integer NOT NULL,
    "statusId" integer NOT NULL,
    kind public."StatusAssetKind" NOT NULL,
    url text NOT NULL,
    "mimeType" text NOT NULL,
    width integer,
    height integer,
    "durationSec" integer,
    caption text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."StatusAsset" OWNER TO doadmin;

--
-- Name: StatusAsset_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."StatusAsset_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."StatusAsset_id_seq" OWNER TO doadmin;

--
-- Name: StatusAsset_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."StatusAsset_id_seq" OWNED BY public."StatusAsset".id;


--
-- Name: StatusKey; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."StatusKey" (
    "statusId" integer NOT NULL,
    "userId" integer NOT NULL,
    "encryptedKey" text NOT NULL
);


ALTER TABLE public."StatusKey" OWNER TO doadmin;

--
-- Name: StatusReaction; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."StatusReaction" (
    "statusId" integer NOT NULL,
    "userId" integer NOT NULL,
    emoji text NOT NULL
);


ALTER TABLE public."StatusReaction" OWNER TO doadmin;

--
-- Name: StatusView; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."StatusView" (
    id integer NOT NULL,
    "statusId" integer NOT NULL,
    "viewerId" integer NOT NULL,
    "viewedAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."StatusView" OWNER TO doadmin;

--
-- Name: StatusView_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."StatusView_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."StatusView_id_seq" OWNER TO doadmin;

--
-- Name: StatusView_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."StatusView_id_seq" OWNED BY public."StatusView".id;


--
-- Name: Status_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."Status_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Status_id_seq" OWNER TO doadmin;

--
-- Name: Status_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."Status_id_seq" OWNED BY public."Status".id;


--
-- Name: Subscriber; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Subscriber" (
    id integer NOT NULL,
    "userId" integer,
    provider text NOT NULL,
    "providerProfileId" text,
    iccid text,
    "iccidHint" text,
    smdp text,
    "activationCode" text,
    "lpaUri" text,
    "qrPayload" text,
    msisdn text,
    region character varying(8),
    status text DEFAULT 'PENDING'::text NOT NULL,
    "providerMeta" jsonb,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "activatedAt" timestamp(3) without time zone,
    "suspendedAt" timestamp(3) without time zone,
    "expiresAt" timestamp(3) without time zone,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Subscriber" OWNER TO doadmin;

--
-- Name: Subscriber_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."Subscriber_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Subscriber_id_seq" OWNER TO doadmin;

--
-- Name: Subscriber_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."Subscriber_id_seq" OWNED BY public."Subscriber".id;


--
-- Name: SupportTicket; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."SupportTicket" (
    id integer NOT NULL,
    name text NOT NULL,
    email text NOT NULL,
    message text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."SupportTicket" OWNER TO doadmin;

--
-- Name: SupportTicket_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."SupportTicket_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."SupportTicket_id_seq" OWNER TO doadmin;

--
-- Name: SupportTicket_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."SupportTicket_id_seq" OWNED BY public."SupportTicket".id;


--
-- Name: ThreadState; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."ThreadState" (
    "userId" integer NOT NULL,
    "chatRoomId" integer NOT NULL,
    "deletedAt" timestamp(3) without time zone
);


ALTER TABLE public."ThreadState" OWNER TO doadmin;

--
-- Name: Transcript; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Transcript" (
    id text NOT NULL,
    "userId" integer NOT NULL,
    "callId" text,
    "messageId" integer,
    language text,
    segments jsonb NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Transcript" OWNER TO doadmin;

--
-- Name: Translation; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Translation" (
    id integer NOT NULL,
    language text NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "updatedAt" timestamp(3) without time zone NOT NULL
);


ALTER TABLE public."Translation" OWNER TO doadmin;

--
-- Name: Translation_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."Translation_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Translation_id_seq" OWNER TO doadmin;

--
-- Name: Translation_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."Translation_id_seq" OWNED BY public."Translation".id;


--
-- Name: TwoFactorRecoveryCode; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."TwoFactorRecoveryCode" (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "codeHash" text NOT NULL,
    "usedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."TwoFactorRecoveryCode" OWNER TO doadmin;

--
-- Name: TwoFactorRecoveryCode_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."TwoFactorRecoveryCode_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."TwoFactorRecoveryCode_id_seq" OWNER TO doadmin;

--
-- Name: TwoFactorRecoveryCode_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."TwoFactorRecoveryCode_id_seq" OWNED BY public."TwoFactorRecoveryCode".id;


--
-- Name: Upload; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Upload" (
    id integer NOT NULL,
    "ownerId" integer NOT NULL,
    key text NOT NULL,
    sha256 character varying(64) NOT NULL,
    "originalName" text NOT NULL,
    "mimeType" text NOT NULL,
    size integer NOT NULL,
    driver text NOT NULL,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."Upload" OWNER TO doadmin;

--
-- Name: Upload_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."Upload_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."Upload_id_seq" OWNER TO doadmin;

--
-- Name: Upload_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."Upload_id_seq" OWNED BY public."Upload".id;


--
-- Name: User; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."User" (
    id integer NOT NULL,
    email text,
    username text NOT NULL,
    "phoneNumber" character varying(32),
    password text,
    "preferredLanguage" text DEFAULT 'en'::text NOT NULL,
    "allowExplicitContent" boolean DEFAULT false NOT NULL,
    "showOriginalWithTranslation" boolean DEFAULT true NOT NULL,
    role text DEFAULT 'USER'::text NOT NULL,
    "enableAIResponder" boolean DEFAULT false NOT NULL,
    "publicKey" text,
    "autoDeleteSeconds" integer,
    "showReadReceipts" boolean DEFAULT true NOT NULL,
    "avatarUrl" text,
    "emojiTag" text,
    "enableSmartReplies" boolean DEFAULT false NOT NULL,
    "autoResponderActiveUntil" timestamp(3) without time zone,
    "autoResponderCooldownSec" integer DEFAULT 120 NOT NULL,
    "autoResponderMode" public."AutoResponderMode" DEFAULT 'DM'::public."AutoResponderMode" NOT NULL,
    "autoResponderSignature" text,
    plan public."Plan" DEFAULT 'FREE'::public."Plan" NOT NULL,
    "messageTone" text DEFAULT 'Default.mp3'::text,
    ringtone text DEFAULT 'Classic.mp3'::text,
    "a11yCaptionBg" text DEFAULT 'dark'::text NOT NULL,
    "a11yCaptionFont" text DEFAULT 'lg'::text NOT NULL,
    "a11yFlashOnCall" boolean DEFAULT false NOT NULL,
    "a11yLiveCaptions" boolean DEFAULT false NOT NULL,
    "a11yVibrate" boolean DEFAULT false NOT NULL,
    "a11yVisualAlerts" boolean DEFAULT false NOT NULL,
    "a11yVoiceNoteSTT" boolean DEFAULT false NOT NULL,
    theme text DEFAULT 'dawn'::text NOT NULL,
    "notifyOnCopy" boolean DEFAULT false NOT NULL,
    "privacyBlurEnabled" boolean DEFAULT false NOT NULL,
    "privacyHoldToReveal" boolean DEFAULT false NOT NULL,
    "ageAttestedAt" timestamp(3) without time zone,
    "ageBand" public."AgeBand",
    "randomChatAllowedBands" jsonb,
    "wantsAgeFilter" boolean DEFAULT true NOT NULL,
    "strictE2EE" boolean DEFAULT false NOT NULL,
    cycling boolean DEFAULT false NOT NULL,
    "emailVerifiedAt" timestamp(3) without time zone,
    "emailVerifiedIp" text,
    "phoneVerifiedAt" timestamp(3) without time zone,
    "phoneVerifiedIp" text,
    "totpSecretEnc" text,
    "twoFactorEnabled" boolean DEFAULT false NOT NULL,
    "twoFactorEnrolledAt" timestamp(3) without time zone,
    "a11yUiFont" text DEFAULT 'md'::text NOT NULL,
    "a11yCaptionMaxLines" integer DEFAULT 3 NOT NULL,
    "a11yCaptionPosition" text DEFAULT 'bottom'::text NOT NULL,
    "a11yStoreTranscripts" boolean DEFAULT true NOT NULL,
    "a11yTranscriptRetentionDays" integer,
    "autoTranslate" boolean DEFAULT true NOT NULL,
    "privacyBlurOnUnfocus" boolean DEFAULT false NOT NULL,
    "billingCountry" character varying(2),
    currency character varying(8),
    "firstPaidAt" timestamp(3) without time zone,
    "pricingRegion" public."RegionTier",
    "foriaRemember" boolean DEFAULT true NOT NULL,
    "voicemailAutoDeleteDays" integer,
    "voicemailEnabled" boolean DEFAULT true NOT NULL,
    "voicemailForwardEmail" text,
    "voicemailGreetingText" text,
    "voicemailGreetingUrl" text,
    "forwardEmail" character varying(255),
    "forwardPhoneNumber" character varying(32),
    "forwardQuietHoursEnd" integer,
    "forwardQuietHoursStart" integer,
    "forwardSmsToEmail" boolean DEFAULT false NOT NULL,
    "forwardSmsToPhone" boolean DEFAULT false NOT NULL,
    "forwardToPhoneE164" character varying(32),
    "forwardingEnabledCalls" boolean DEFAULT false NOT NULL,
    "forwardingEnabledSms" boolean DEFAULT false NOT NULL,
    "tokenVersion" integer DEFAULT 0 NOT NULL,
    "passwordHash" text,
    "googleSub" text,
    "appleSub" text,
    "displayName" text,
    "encryptedPrivateKeyBundle" text,
    iccid text,
    "privateKeyWrapIterations" integer,
    "privateKeyWrapKdf" text,
    "privateKeyWrapSalt" text,
    "privateKeyWrapVersion" integer DEFAULT 1 NOT NULL,
    "billingCustomerId" text,
    "billingProvider" text,
    "billingSubscriptionId" text,
    "subscriptionEndsAt" timestamp(3) without time zone,
    "subscriptionStatus" text DEFAULT 'INACTIVE'::text NOT NULL,
    "uiLanguage" text DEFAULT 'en'::text NOT NULL
);


ALTER TABLE public."User" OWNER TO doadmin;

--
-- Name: User_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."User_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."User_id_seq" OWNER TO doadmin;

--
-- Name: User_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."User_id_seq" OWNED BY public."User".id;


--
-- Name: VerificationToken; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."VerificationToken" (
    id integer NOT NULL,
    "userId" integer NOT NULL,
    "tokenHash" text NOT NULL,
    "expiresAt" timestamp(3) without time zone NOT NULL,
    "usedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    type text NOT NULL
);


ALTER TABLE public."VerificationToken" OWNER TO doadmin;

--
-- Name: VerificationToken_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."VerificationToken_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."VerificationToken_id_seq" OWNER TO doadmin;

--
-- Name: VerificationToken_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."VerificationToken_id_seq" OWNED BY public."VerificationToken".id;


--
-- Name: VoiceLog; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."VoiceLog" (
    id integer NOT NULL,
    "callSid" text NOT NULL,
    "from" text,
    "to" text,
    direction text,
    status text NOT NULL,
    "answeredBy" text,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "durationSec" integer,
    "rawPayload" jsonb,
    "timestamp" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public."VoiceLog" OWNER TO doadmin;

--
-- Name: VoiceLog_id_seq; Type: SEQUENCE; Schema: public; Owner: doadmin
--

CREATE SEQUENCE public."VoiceLog_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public."VoiceLog_id_seq" OWNER TO doadmin;

--
-- Name: VoiceLog_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: doadmin
--

ALTER SEQUENCE public."VoiceLog_id_seq" OWNED BY public."VoiceLog".id;


--
-- Name: Voicemail; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."Voicemail" (
    id text NOT NULL,
    "userId" integer NOT NULL,
    "phoneNumberId" integer,
    "fromNumber" text NOT NULL,
    "toNumber" text NOT NULL,
    "audioUrl" text NOT NULL,
    "durationSec" integer,
    transcript text,
    "transcriptStatus" public."VoicemailTranscriptStatus" DEFAULT 'PENDING'::public."VoicemailTranscriptStatus" NOT NULL,
    "isRead" boolean DEFAULT false NOT NULL,
    deleted boolean DEFAULT false NOT NULL,
    "deletedAt" timestamp(3) without time zone,
    "createdAt" timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    "forwardedToEmailAt" timestamp(3) without time zone,
    "relatedCallId" integer
);


ALTER TABLE public."Voicemail" OWNER TO doadmin;

--
-- Name: _RandomChatParticipants; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."_RandomChatParticipants" (
    "A" integer NOT NULL,
    "B" integer NOT NULL
);


ALTER TABLE public."_RandomChatParticipants" OWNER TO doadmin;

--
-- Name: _ReadMessages; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public."_ReadMessages" (
    "A" integer NOT NULL,
    "B" integer NOT NULL
);


ALTER TABLE public."_ReadMessages" OWNER TO doadmin;

--
-- Name: _prisma_migrations; Type: TABLE; Schema: public; Owner: doadmin
--

CREATE TABLE public._prisma_migrations (
    id character varying(36) NOT NULL,
    checksum character varying(64) NOT NULL,
    finished_at timestamp with time zone,
    migration_name character varying(255) NOT NULL,
    logs text,
    rolled_back_at timestamp with time zone,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    applied_steps_count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public._prisma_migrations OWNER TO doadmin;

--
-- Name: AdInquiry id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."AdInquiry" ALTER COLUMN id SET DEFAULT nextval('public."AdInquiry_id_seq"'::regclass);


--
-- Name: AuditLog id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."AuditLog" ALTER COLUMN id SET DEFAULT nextval('public."AuditLog_id_seq"'::regclass);


--
-- Name: Bot id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Bot" ALTER COLUMN id SET DEFAULT nextval('public."Bot_id_seq"'::regclass);


--
-- Name: BotEventLog id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."BotEventLog" ALTER COLUMN id SET DEFAULT nextval('public."BotEventLog_id_seq"'::regclass);


--
-- Name: BotInstall id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."BotInstall" ALTER COLUMN id SET DEFAULT nextval('public."BotInstall_id_seq"'::regclass);


--
-- Name: Call id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Call" ALTER COLUMN id SET DEFAULT nextval('public."Call_id_seq"'::regclass);


--
-- Name: ChatRoom id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ChatRoom" ALTER COLUMN id SET DEFAULT nextval('public."ChatRoom_id_seq"'::regclass);


--
-- Name: ChatRoomInvite id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ChatRoomInvite" ALTER COLUMN id SET DEFAULT nextval('public."ChatRoomInvite_id_seq"'::regclass);


--
-- Name: Contact id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Contact" ALTER COLUMN id SET DEFAULT nextval('public."Contact_id_seq"'::regclass);


--
-- Name: FamilyGroup id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."FamilyGroup" ALTER COLUMN id SET DEFAULT nextval('public."FamilyGroup_id_seq"'::regclass);


--
-- Name: FamilyInvite id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."FamilyInvite" ALTER COLUMN id SET DEFAULT nextval('public."FamilyInvite_id_seq"'::regclass);


--
-- Name: FamilyMember id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."FamilyMember" ALTER COLUMN id SET DEFAULT nextval('public."FamilyMember_id_seq"'::regclass);


--
-- Name: Follow id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Follow" ALTER COLUMN id SET DEFAULT nextval('public."Follow_id_seq"'::regclass);


--
-- Name: ForiaMessage id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ForiaMessage" ALTER COLUMN id SET DEFAULT nextval('public."ForiaMessage_id_seq"'::regclass);


--
-- Name: Language id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Language" ALTER COLUMN id SET DEFAULT nextval('public."Language_id_seq"'::regclass);


--
-- Name: Message id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Message" ALTER COLUMN id SET DEFAULT nextval('public."Message_id_seq"'::regclass);


--
-- Name: MessageAttachment id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageAttachment" ALTER COLUMN id SET DEFAULT nextval('public."MessageAttachment_id_seq"'::regclass);


--
-- Name: MessageDeletion id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageDeletion" ALTER COLUMN id SET DEFAULT nextval('public."MessageDeletion_id_seq"'::regclass);


--
-- Name: MobileDataPackPurchase id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MobileDataPackPurchase" ALTER COLUMN id SET DEFAULT nextval('public."MobileDataPackPurchase_id_seq"'::regclass);


--
-- Name: NumberReservation id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."NumberReservation" ALTER COLUMN id SET DEFAULT nextval('public."NumberReservation_id_seq"'::regclass);


--
-- Name: Participant id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Participant" ALTER COLUMN id SET DEFAULT nextval('public."Participant_id_seq"'::regclass);


--
-- Name: PasswordResetToken id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PasswordResetToken" ALTER COLUMN id SET DEFAULT nextval('public."PasswordResetToken_id_seq"'::regclass);


--
-- Name: PeopleInvite id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PeopleInvite" ALTER COLUMN id SET DEFAULT nextval('public."PeopleInvite_id_seq"'::regclass);


--
-- Name: Phone id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Phone" ALTER COLUMN id SET DEFAULT nextval('public."Phone_id_seq"'::regclass);


--
-- Name: PhoneNumber id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PhoneNumber" ALTER COLUMN id SET DEFAULT nextval('public."PhoneNumber_id_seq"'::regclass);


--
-- Name: PhoneOtp id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PhoneOtp" ALTER COLUMN id SET DEFAULT nextval('public."PhoneOtp_id_seq"'::regclass);


--
-- Name: PhoneVerificationRequest id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PhoneVerificationRequest" ALTER COLUMN id SET DEFAULT nextval('public."PhoneVerificationRequest_id_seq"'::regclass);


--
-- Name: RandomChatRoom id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."RandomChatRoom" ALTER COLUMN id SET DEFAULT nextval('public."RandomChatRoom_id_seq"'::regclass);


--
-- Name: Report id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Report" ALTER COLUMN id SET DEFAULT nextval('public."Report_id_seq"'::regclass);


--
-- Name: STTUsage id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."STTUsage" ALTER COLUMN id SET DEFAULT nextval('public."STTUsage_id_seq"'::regclass);


--
-- Name: ScheduledMessage id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ScheduledMessage" ALTER COLUMN id SET DEFAULT nextval('public."ScheduledMessage_id_seq"'::regclass);


--
-- Name: SmsCarrierEvent id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsCarrierEvent" ALTER COLUMN id SET DEFAULT nextval('public."SmsCarrierEvent_id_seq"'::regclass);


--
-- Name: SmsConsent id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsConsent" ALTER COLUMN id SET DEFAULT nextval('public."SmsConsent_id_seq"'::regclass);


--
-- Name: SmsMessage id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsMessage" ALTER COLUMN id SET DEFAULT nextval('public."SmsMessage_id_seq"'::regclass);


--
-- Name: SmsOptOut id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsOptOut" ALTER COLUMN id SET DEFAULT nextval('public."SmsOptOut_id_seq"'::regclass);


--
-- Name: SmsParticipant id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsParticipant" ALTER COLUMN id SET DEFAULT nextval('public."SmsParticipant_id_seq"'::regclass);


--
-- Name: SmsThread id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsThread" ALTER COLUMN id SET DEFAULT nextval('public."SmsThread_id_seq"'::regclass);


--
-- Name: Status id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Status" ALTER COLUMN id SET DEFAULT nextval('public."Status_id_seq"'::regclass);


--
-- Name: StatusAsset id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."StatusAsset" ALTER COLUMN id SET DEFAULT nextval('public."StatusAsset_id_seq"'::regclass);


--
-- Name: StatusView id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."StatusView" ALTER COLUMN id SET DEFAULT nextval('public."StatusView_id_seq"'::regclass);


--
-- Name: Subscriber id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Subscriber" ALTER COLUMN id SET DEFAULT nextval('public."Subscriber_id_seq"'::regclass);


--
-- Name: SupportTicket id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SupportTicket" ALTER COLUMN id SET DEFAULT nextval('public."SupportTicket_id_seq"'::regclass);


--
-- Name: Translation id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Translation" ALTER COLUMN id SET DEFAULT nextval('public."Translation_id_seq"'::regclass);


--
-- Name: TwoFactorRecoveryCode id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."TwoFactorRecoveryCode" ALTER COLUMN id SET DEFAULT nextval('public."TwoFactorRecoveryCode_id_seq"'::regclass);


--
-- Name: Upload id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Upload" ALTER COLUMN id SET DEFAULT nextval('public."Upload_id_seq"'::regclass);


--
-- Name: User id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."User" ALTER COLUMN id SET DEFAULT nextval('public."User_id_seq"'::regclass);


--
-- Name: VerificationToken id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."VerificationToken" ALTER COLUMN id SET DEFAULT nextval('public."VerificationToken_id_seq"'::regclass);


--
-- Name: VoiceLog id; Type: DEFAULT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."VoiceLog" ALTER COLUMN id SET DEFAULT nextval('public."VoiceLog_id_seq"'::regclass);


--
-- Data for Name: AdInquiry; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."AdInquiry" (id, name, email, company, budget, message, status, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: AuditLog; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."AuditLog" (id, "actorId", action, resource, "resourceId", status, ip, "userAgent", metadata, "createdAt") FROM stdin;
\.


--
-- Data for Name: Bot; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Bot" (id, "ownerId", name, url, secret, "serviceUserId", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: BotEventLog; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."BotEventLog" (id, "installId", "eventId", type, payload, status, attempts, "nextAttemptAt", "lastError", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: BotInstall; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."BotInstall" (id, "botId", "chatRoomId", "contentScope", "isEnabled", scopes, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Call; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Call" ("callerId", "calleeId", mode, status, "createdAt", "endedAt", "answerSdp", "offerSdp", "roomId", "startedAt", id) FROM stdin;
\.


--
-- Data for Name: ChatRoom; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."ChatRoom" (id, "createdAt", "isGroup", name, "updatedAt", "autoTranslateMode", "aiAssistantMode", "allowForiaBot", "ownerId") FROM stdin;
\.


--
-- Data for Name: ChatRoomInvite; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."ChatRoomInvite" (id, code, "chatRoomId", "createdById", "maxUses", uses, "expiresAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: Contact; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Contact" (id, "ownerId", "userId", alias, favorite, "createdAt", "externalName", "externalPhone", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Device; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Device" (id, "userId", "publicKey", name, platform, "isPrimary", "createdAt", "lastSeenAt", "revokedAt", "revokedById", "deviceId", "keyAlgorithm", "keyVersion", "updatedAt", "pairingApprovedAt", "pairingRejectedAt", "pairingRequestedAt", "pairingStatus", "wrappedAccountKey", "wrappedAccountKeyAlgo", "wrappedAccountKeyVer") FROM stdin;
\.


--
-- Data for Name: FamilyGroup; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."FamilyGroup" (id, "ownerId", name, "totalDataMb", "usedDataMb", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: FamilyInvite; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."FamilyInvite" (id, "groupId", email, phone, token, status, "expiresAt", "acceptedAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: FamilyMember; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."FamilyMember" (id, "groupId", "userId", role, "limitDataMb", "usedDataMb", "createdAt") FROM stdin;
\.


--
-- Data for Name: Follow; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Follow" (id, "followerId", "followingId", "createdAt") FROM stdin;
\.


--
-- Data for Name: ForiaMessage; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."ForiaMessage" (id, "userId", role, content, "createdAt") FROM stdin;
\.


--
-- Data for Name: Language; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Language" (id, code, "displayName", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Message; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Message" (id, "senderId", "chatRoomId", "createdAt", "imageUrl", "translatedFrom", "isExplicit", "rawContent", "randomChatRoomId", "deletedBySender", "expiresAt", translations, "isAutoReply", "audioDurationSec", "audioUrl", "translatedContent", "translatedTo", "contentCiphertext", "deletedAt", "deletedById", "deletedForAll", "clientMessageId", "editedAt", revision, "isHiddenByModeration", "moderationStatus") FROM stdin;
\.


--
-- Data for Name: MessageAttachment; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."MessageAttachment" (id, "messageId", kind, url, "mimeType", width, height, "durationSec", caption, "createdAt", "fileSize", waveform, "thumbUrl", "deletedAt") FROM stdin;
\.


--
-- Data for Name: MessageDeletion; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."MessageDeletion" (id, "messageId", "userId", "createdAt") FROM stdin;
\.


--
-- Data for Name: MessageKey; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."MessageKey" ("messageId", "userId", "encryptedKey") FROM stdin;
\.


--
-- Data for Name: MessageReaction; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."MessageReaction" ("messageId", "userId", emoji, "createdAt") FROM stdin;
\.


--
-- Data for Name: MessageRead; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."MessageRead" ("messageId", "userId", "readAt") FROM stdin;
\.


--
-- Data for Name: MessageSessionKey; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."MessageSessionKey" (id, "recipientDeviceId", "encryptedSessionKey", "messageId", "recipientUserId") FROM stdin;
\.


--
-- Data for Name: MobileDataPackPurchase; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."MobileDataPackPurchase" (id, "userId", "expiresAt", "purchasedAt", "addonKind", kind, "provisioningError", "qrCodeSvg", "remainingDataMb", "stripeCheckoutSessionId", "stripePaymentIntentId", "tealProfileId", "totalDataMb", iccid) FROM stdin;
\.


--
-- Data for Name: NumberReservation; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."NumberReservation" (id, "phoneNumberId", "userId", "expiresAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: Participant; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Participant" (id, "userId", "chatRoomId", "joinedAt", "allowAIBot", role, "archivedAt", "clearedAt") FROM stdin;
\.


--
-- Data for Name: PasswordResetToken; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."PasswordResetToken" (id, "userId", "expiresAt", "usedAt", "tokenHash") FROM stdin;
\.


--
-- Data for Name: PeopleInvite; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."PeopleInvite" (id, code, "inviterUserId", "targetPhone", "targetEmail", channel, status, "acceptedByUserId", "createdAt", "updatedAt", "expiresAt") FROM stdin;
\.


--
-- Data for Name: Phone; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Phone" (id, number, "userId", "optedOut", "optedOutAt", "verifiedAt", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: PhoneNumber; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."PhoneNumber" (id, e164, provider, "areaCode", vanity, status, "assignedUserId", "assignedAt", "lastOutboundAt", "keepLocked", "holdUntil", "releaseAfter", "portStatus", "createdAt", "updatedAt", source, "twilioSid", capabilities, "isoCountry", "forSale") FROM stdin;
\.


--
-- Data for Name: PhoneOtp; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."PhoneOtp" (id, phone, "otpCode", "providerMessageId", attempts, "expiresAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: PhoneVerificationRequest; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."PhoneVerificationRequest" (id, "phoneNumber", "verificationCode", "expiresAt", "consentedAt", "ipAddress", "userAgent", intent, "verifiedAt", "consumedAt", "phoneVerificationId", "createdAt", "phoneId") FROM stdin;
\.


--
-- Data for Name: PortRequest; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."PortRequest" (id, "userId", "phoneNumber", "externalPortId", carrier, "accountNumber", pin, "fullName", "addressLine1", "addressLine2", city, state, "postalCode", country, status, "statusReason", "scheduledAt", "completedAt", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: Price; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Price" (id, product, tier, currency, "unitAmount", "stripePriceId", "appleSku", "googleSku", active) FROM stdin;
\.


--
-- Data for Name: PriceOverride; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."PriceOverride" (id, "countryCode", plan, currency, "priceCents", "stripePriceId", "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: ProvisionLink; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."ProvisionLink" (id, secret, "expiresAt", "usedAt", "sasCode", "createdAt", "userId", "createdById") FROM stdin;
\.


--
-- Data for Name: RandomChatRoom; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."RandomChatRoom" (id, "createdAt", "aiEnabled") FROM stdin;
\.


--
-- Data for Name: RegionRule; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."RegionRule" (id, "countryCode", tier) FROM stdin;
\.


--
-- Data for Name: Report; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Report" (id, "messageId", "reporterId", "decryptedContent", "createdAt", notes, "resolvedAt", status, "blockApplied", "chatRoomId", details, evidence, reason, "reportedUserId", "aiCategory", "aiSummary", "autoHidden", priority, "recommendedAction", "reviewedByAiAt", "scoreFactors", "severityScore") FROM stdin;
\.


--
-- Data for Name: STTUsage; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."STTUsage" (id, "userId", "monthKey", seconds, "updatedAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: ScheduledMessage; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."ScheduledMessage" (id, "chatRoomId", "senderId", content, "scheduledAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: SmsCarrierEvent; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."SmsCarrierEvent" (id, "from", "to", body, direction, action, metadata, "createdAt") FROM stdin;
\.


--
-- Data for Name: SmsConsent; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."SmsConsent" (id, phone, "pendingRegistration", "consentTextVersion", "ipAddress", "userAgent", "createdAt") FROM stdin;
\.


--
-- Data for Name: SmsMessage; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."SmsMessage" (id, "threadId", direction, "fromNumber", "toNumber", body, provider, "createdAt", "mediaUrls", "providerMessageId", "editedAt", "phoneId") FROM stdin;
\.


--
-- Data for Name: SmsOptOut; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."SmsOptOut" (id, phone, provider, reason, "inboundMessageId", "rawPayload", "ipAddress", "userAgent", "createdAt") FROM stdin;
\.


--
-- Data for Name: SmsParticipant; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."SmsParticipant" (id, "threadId", phone, "createdAt") FROM stdin;
\.


--
-- Data for Name: SmsThread; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."SmsThread" (id, "userId", "createdAt", "updatedAt", "archivedAt", "contactId", "contactPhone", "deletedAt") FROM stdin;
\.


--
-- Data for Name: Status; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Status" (id, "authorId", "captionCiphertext", "encryptedKeys", "translatedFrom", translations, "isExplicit", audience, "expiresAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: StatusAsset; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."StatusAsset" (id, "statusId", kind, url, "mimeType", width, height, "durationSec", caption, "createdAt") FROM stdin;
\.


--
-- Data for Name: StatusKey; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."StatusKey" ("statusId", "userId", "encryptedKey") FROM stdin;
\.


--
-- Data for Name: StatusReaction; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."StatusReaction" ("statusId", "userId", emoji) FROM stdin;
\.


--
-- Data for Name: StatusView; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."StatusView" (id, "statusId", "viewerId", "viewedAt") FROM stdin;
\.


--
-- Data for Name: Subscriber; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Subscriber" (id, "userId", provider, "providerProfileId", iccid, "iccidHint", smdp, "activationCode", "lpaUri", "qrPayload", msisdn, region, status, "providerMeta", "createdAt", "activatedAt", "suspendedAt", "expiresAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: SupportTicket; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."SupportTicket" (id, name, email, message, status, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: ThreadState; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."ThreadState" ("userId", "chatRoomId", "deletedAt") FROM stdin;
\.


--
-- Data for Name: Transcript; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Transcript" (id, "userId", "callId", "messageId", language, segments, "createdAt") FROM stdin;
\.


--
-- Data for Name: Translation; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Translation" (id, language, key, value, "createdAt", "updatedAt") FROM stdin;
\.


--
-- Data for Name: TwoFactorRecoveryCode; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."TwoFactorRecoveryCode" (id, "userId", "codeHash", "usedAt", "createdAt") FROM stdin;
\.


--
-- Data for Name: Upload; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Upload" (id, "ownerId", key, sha256, "originalName", "mimeType", size, driver, "createdAt") FROM stdin;
\.


--
-- Data for Name: User; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."User" (id, email, username, "phoneNumber", password, "preferredLanguage", "allowExplicitContent", "showOriginalWithTranslation", role, "enableAIResponder", "publicKey", "autoDeleteSeconds", "showReadReceipts", "avatarUrl", "emojiTag", "enableSmartReplies", "autoResponderActiveUntil", "autoResponderCooldownSec", "autoResponderMode", "autoResponderSignature", plan, "messageTone", ringtone, "a11yCaptionBg", "a11yCaptionFont", "a11yFlashOnCall", "a11yLiveCaptions", "a11yVibrate", "a11yVisualAlerts", "a11yVoiceNoteSTT", theme, "notifyOnCopy", "privacyBlurEnabled", "privacyHoldToReveal", "ageAttestedAt", "ageBand", "randomChatAllowedBands", "wantsAgeFilter", "strictE2EE", cycling, "emailVerifiedAt", "emailVerifiedIp", "phoneVerifiedAt", "phoneVerifiedIp", "totpSecretEnc", "twoFactorEnabled", "twoFactorEnrolledAt", "a11yUiFont", "a11yCaptionMaxLines", "a11yCaptionPosition", "a11yStoreTranscripts", "a11yTranscriptRetentionDays", "autoTranslate", "privacyBlurOnUnfocus", "billingCountry", currency, "firstPaidAt", "pricingRegion", "foriaRemember", "voicemailAutoDeleteDays", "voicemailEnabled", "voicemailForwardEmail", "voicemailGreetingText", "voicemailGreetingUrl", "forwardEmail", "forwardPhoneNumber", "forwardQuietHoursEnd", "forwardQuietHoursStart", "forwardSmsToEmail", "forwardSmsToPhone", "forwardToPhoneE164", "forwardingEnabledCalls", "forwardingEnabledSms", "tokenVersion", "passwordHash", "googleSub", "appleSub", "displayName", "encryptedPrivateKeyBundle", iccid, "privateKeyWrapIterations", "privateKeyWrapKdf", "privateKeyWrapSalt", "privateKeyWrapVersion", "billingCustomerId", "billingProvider", "billingSubscriptionId", "subscriptionEndsAt", "subscriptionStatus", "uiLanguage") FROM stdin;
\.


--
-- Data for Name: VerificationToken; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."VerificationToken" (id, "userId", "tokenHash", "expiresAt", "usedAt", "createdAt", type) FROM stdin;
\.


--
-- Data for Name: VoiceLog; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."VoiceLog" (id, "callSid", "from", "to", direction, status, "answeredBy", "createdAt", "durationSec", "rawPayload", "timestamp") FROM stdin;
\.


--
-- Data for Name: Voicemail; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."Voicemail" (id, "userId", "phoneNumberId", "fromNumber", "toNumber", "audioUrl", "durationSec", transcript, "transcriptStatus", "isRead", deleted, "deletedAt", "createdAt", "forwardedToEmailAt", "relatedCallId") FROM stdin;
\.


--
-- Data for Name: _RandomChatParticipants; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."_RandomChatParticipants" ("A", "B") FROM stdin;
\.


--
-- Data for Name: _ReadMessages; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public."_ReadMessages" ("A", "B") FROM stdin;
\.


--
-- Data for Name: _prisma_migrations; Type: TABLE DATA; Schema: public; Owner: doadmin
--

COPY public._prisma_migrations (id, checksum, finished_at, migration_name, logs, rolled_back_at, started_at, applied_steps_count) FROM stdin;
c66bb364-b722-4bb2-8961-f933bc23b778	d5994a1ebc38e41aa0c8e4c82a7e2001b4ebe2c5550d5687eb8245a4bcc11d32	2025-12-30 17:36:05.323063+00	20250815040523_perf_indexes	\N	\N	2025-12-30 17:36:05.301792+00	1
6f566718-2741-4138-a4b6-7c03af46d768	14a7d0b972b5bd3844cabfb6d789b18099fafbaa6797b631c3dac87810dd2425	2025-12-30 17:36:05.02825+00	20250721231621_init	\N	\N	2025-12-30 17:36:05.008238+00	1
8924bc52-f628-4eac-9303-af5b61e9b0db	532560ea1a5fcd410fd7578e5e581b44c8cfa1773b7e5e2870a904e4f248de45	2025-12-30 17:36:05.138284+00	20250801045532_fix_contact_relations	\N	\N	2025-12-30 17:36:05.127422+00	1
c4ebcd74-cee5-4d31-aff4-9b5a3e1b534a	125d192c38ec3e688e00536e7746d626cecc2336cc0274d04af1030a903ed0d5	2025-12-30 17:36:05.056742+00	20250722001118_init	\N	\N	2025-12-30 17:36:05.029986+00	1
a6e67b28-f289-4c8f-8ef5-b08d3b0309b9	eb7b8daec0ee36044749897ffa29c96c41df26fac64762d6285882b2cbf3c99d	2025-12-30 17:36:05.061588+00	20250722034717_add_password_to_user	\N	\N	2025-12-30 17:36:05.05778+00	1
a4ec55fe-857a-4844-8c5a-6d19685e3aaf	04d1873fd747fe771e9b800562b25edd5cf64777d9072160fa1bf5cdeb4dd9ad	2025-12-30 17:36:05.216831+00	20250811041912_add_expires_index	\N	\N	2025-12-30 17:36:05.213298+00	1
a359f420-1d16-488b-a01d-537485571a4a	7096c1104440592c0c820a43d7e3eee2ebdbccdeb83f7d777b29867d80b76cff	2025-12-30 17:36:05.066285+00	20250722231731_add_new_fileds	\N	\N	2025-12-30 17:36:05.062448+00	1
1f7b7c2d-106a-4437-8413-ff2ba2483191	7008986461e2155fd006528e0b167109d1e68f7bbb3a8c0e6f18563075913353	2025-12-30 17:36:05.166183+00	20250809045002_contacts_external_support	\N	\N	2025-12-30 17:36:05.139916+00	1
30988109-2287-4ad7-b13f-6c44b007e4bd	0737b66155f88ffd06fe97c95f36f653ec89da5cb61d2b27e4382b0aef6d9338	2025-12-30 17:36:05.071191+00	20250723003112_add_new_fileds	\N	\N	2025-12-30 17:36:05.067453+00	1
8f7a24e6-4255-461b-83fe-3b5b9d4afbbc	3451f8d080a4e8b0bb791d6a62f48fe3acca4123453fc8ca30230d760ba6ba19	2025-12-30 17:36:05.076512+00	20250723004059_add_new_fileds	\N	\N	2025-12-30 17:36:05.072309+00	1
3117e51e-9ee6-43cb-8f04-ea0a2210dde4	3f75ceede05f94468115b3c371c562d48ea1fdeaa2af262a45baf256e98ad0dd	2025-12-30 17:36:05.082314+00	20250728003309_add_user_preferences	\N	\N	2025-12-30 17:36:05.077521+00	1
586fc17c-faed-4ea4-bf62-02cdd323b94f	d0399d9abea941bc3b37f697375c3387b01da383dc4baf1036bbb8cf0c330fea	2025-12-30 17:36:05.176162+00	20250809194619_audit_log	\N	\N	2025-12-30 17:36:05.167063+00	1
3c1be8f1-5606-4dd9-a4f4-fe1d14facb69	f93db8bd29e203be92c204efaff52aae2d7ccd20cb1ebe3b94152b6df4fefc8a	2025-12-30 17:36:05.087436+00	20250728011824_	\N	\N	2025-12-30 17:36:05.083291+00	1
c1bff65d-bac5-4efc-9d05-9fbf78950087	8427c5e8570a646519a9e5f2acc86a091e5d5dc2a537a006fee261285fa07756	2025-12-30 17:36:05.0993+00	20250729014041_fix_relations_and_random_chat	\N	\N	2025-12-30 17:36:05.08848+00	1
5b89b3f5-16ec-4f30-adf1-aa2e55d26ea9	127ea4bdec1fa056d18c85f6ef8d674b95a910f79f14d3dc8b12e08c794b5e10	2025-12-30 17:36:05.273518+00	20250813021839_add_message_reactions	\N	\N	2025-12-30 17:36:05.264736+00	1
1151ac2a-ef20-4bdf-8f8e-391454e156dc	e4107ff29c35d5e8011d14fec69976948d1536a05dd8881e2499b6546729eeb0	2025-12-30 17:36:05.103829+00	20250729020801_add_ai_responder	\N	\N	2025-12-30 17:36:05.100317+00	1
f07d86ee-ed04-4242-856f-3c28cf1b696a	af9603f0f96ceb0deb536de5176cc3ce45e40f4dbc82587c9fdc1e2d250fb788	2025-12-30 17:36:05.185728+00	20250810030234_message_encrypted_keys_json	\N	\N	2025-12-30 17:36:05.177286+00	1
1dde25e5-2622-4016-b772-c975b9a41192	e61289c25e1c6cd01f570d5d50f22d928254688c8a3ede82d9f6d2c9522f5b4c	2025-12-30 17:36:05.107988+00	20250729023059_add_ai_responder	\N	\N	2025-12-30 17:36:05.104848+00	1
64cfb045-3a55-4c1e-9dc3-8115cdeba048	93830e38da6ed1ce3cd4cf28ec4b428f28767e5836f2bf0db7e64ffdcb8198f4	2025-12-30 17:36:05.11773+00	20250730022727_add_encryption_and_reports	\N	\N	2025-12-30 17:36:05.109255+00	1
528912b4-538e-4e55-9e49-5d9c5f6e0b2e	8a32df30d422696388c0eabbdb78cc067d89916b33ff1df25cd9752303c9e060	2025-12-30 17:36:05.229705+00	20250811201659_fix_device_user_relation	\N	\N	2025-12-30 17:36:05.217678+00	1
74228abc-fe09-4f4b-8e88-dd93c0da869e	a92a49814ab3c44ef4d3fe11cead60e8bd1c7400a1b39883e817c4a01e85963b	2025-12-30 17:36:05.126304+00	20250731021956_add_expires_at_to_message	\N	\N	2025-12-30 17:36:05.119004+00	1
bf41265d-6c94-4cd2-b8b1-3bee75bb67a2	b0712fd6844fb84c3e4c3b0045bf1d5f1749bb054f094380a8ca1897363d093b	2025-12-30 17:36:05.190967+00	20250811013336_add_report_status_fields	\N	\N	2025-12-30 17:36:05.186657+00	1
229221b6-041d-4186-8f51-8ded2f365a8e	d29f10b9ddf38c1ff2eb3284499eca53f93a9be501f64d32bdf64cceaf45c3d7	2025-12-30 17:36:05.195222+00	20250811020520_add_message_translations_json	\N	\N	2025-12-30 17:36:05.192015+00	1
f6af5d2c-bdf6-49e4-858d-3da2f0b26c4a	395f21f1088d1d327be9c3ee404da6092d2e09805b6580bc90719387273faa75	2025-12-30 17:36:05.200762+00	20250811022453_add_message_translations_json	\N	\N	2025-12-30 17:36:05.196532+00	1
a1f7925e-2109-413e-9366-4b1d52831f90	43f57f6eee017b9e71da93f06f2fc55b02d7875749509679299791783f64a5a9	2025-12-30 17:36:05.234615+00	20250811204033_add_auto_translate_mode	\N	\N	2025-12-30 17:36:05.230813+00	1
c9c00b00-e267-49e1-9b51-3a5da1893742	3e5b278f5a9dc832ce4606f7ea9d5b819401f0a426d23587853abf05caa4c99d	2025-12-30 17:36:05.212258+00	20250811033613_add_message_translations_json	\N	\N	2025-12-30 17:36:05.20163+00	1
4a8eb34b-9909-4d4a-9db4-620c1f57cf7e	125202a058b3c490a3f7d2476dbeee8fcfea81cb345610b59dabd9ee413d8b13	2025-12-30 17:36:05.241092+00	20250811213315_update	\N	\N	2025-12-30 17:36:05.23542+00	1
99512cac-7584-43bf-b90a-cc41c0d796e9	82c3098f99ae84dda4e691db1002c38f62ed37cf52101a2fa1a8fd9c9bb03227	2025-12-30 17:36:05.277779+00	20250813024756_reactions_and_stickers	\N	\N	2025-12-30 17:36:05.274406+00	1
343be45b-cb0e-4fa8-b371-89de9fab7707	a78df34aaf4e6712f4d8c4715232f26fe4030c1d81f20801dfb71fd34824754b	2025-12-30 17:36:05.247245+00	20250812001446_group_roles_participant	\N	\N	2025-12-30 17:36:05.242047+00	1
428f9705-5f68-47b6-bcfb-cd6f430c5305	f0799e58bb1c58c256d58d2c83a751a2f57e6ebd1d3a756c3918b8936bf134d0	2025-12-30 17:36:05.263719+00	20250812021800_attachments_table	\N	\N	2025-12-30 17:36:05.248576+00	1
8ec07025-74cc-4caa-aa20-bd48b4a9bbcb	bef5fd8ef67c8fa8b4530d00da00bf4838001ba8e6e03ad2675b684a575f791d	2025-12-30 17:36:05.381544+00	20250826041659_add_calls	\N	\N	2025-12-30 17:36:05.338513+00	1
3adea2a0-e651-45d8-81dc-a487e064b0ec	096fd195432ed6a1c01a2d839158dc097242f39bc6cdb453ee68578665e2bdf9	2025-12-30 17:36:05.300833+00	20250813032437_status_stories	\N	\N	2025-12-30 17:36:05.279582+00	1
4e3abd33-e2a2-4d73-aaa4-e5115260d052	aa05eb3ab8b9a5d250994765e1ce84eb4f838dff166b32eb458bc29329774958	2025-12-30 17:36:05.337547+00	20250819031801_add_scheduled_message	\N	\N	2025-12-30 17:36:05.332431+00	1
f513396d-49ff-41f7-8393-1e25f0fbf5fb	11cb5f08d5216fd9e697394a459330b7bb2547850e62227f24e02736be9b72f4	2025-12-30 17:36:05.327056+00	20250817041335_add_user_plan_enum	\N	\N	2025-12-30 17:36:05.324004+00	1
cb9d984d-5b8a-4ec4-9c02-6219f483edde	18c0a00cf1a68bdd0915bc2dad6aa12e558b4289876b45f6d4e73a11d8cd060b	2025-12-30 17:36:05.33153+00	20250818021308_add_tones	\N	\N	2025-12-30 17:36:05.327765+00	1
7818c3db-68b7-4efc-a361-bad3546f9831	2be8a2708e9fc277a95ecebabdb900f586f70c04079c65cc4b5ac4dc592f5c23	2025-12-30 17:36:05.393549+00	20250829044800_add_phone_numbers	\N	\N	2025-12-30 17:36:05.382404+00	1
4de74a87-160a-4bd5-a4f0-19d05334fd4c	2366776f4184f093d507a1205476703aea337b14c23a696781fbbc30d4d08dee	2025-12-30 17:36:05.407672+00	20250830012859_add_stripe_customer_fields	\N	\N	2025-12-30 17:36:05.394364+00	1
cdd67973-1709-4a7a-864b-1f1636ef6fac	7f1e08c6e0da259f64497544a63a9c0cbd93dbd11afff675047b733a18da7f09	2025-12-30 17:36:05.412927+00	20250830014602_add_stripe_customer_fields	\N	\N	2025-12-30 17:36:05.40893+00	1
62347b9e-2fd5-4bb8-a97c-640f1993b512	e21f57dacf86e571680d50ea0ed799c4e166e43886226124b45bcf617275ebc9	2025-12-30 17:36:05.418273+00	20250830031216_privacy_toggles	\N	\N	2025-12-30 17:36:05.413759+00	1
2d738662-b28b-4543-bb71-b0a9c898f3ed	abd375aa983be477f97aea042cdfa97a18ab93b72dfcb695994ea5c6d37b1a4b	2025-12-30 17:36:05.422829+00	20250830031832_add_age_band	\N	\N	2025-12-30 17:36:05.419128+00	1
b1f05ecc-a5dc-4490-aa37-1bfb3d4bab30	e56ed35433d23b77534fdefd223d66a00358d075f008d5570845ff745d877047	2025-12-30 17:36:05.725103+00	20251220013603_add_sms_provider_message_id_and_media	\N	\N	2025-12-30 17:36:05.721064+00	1
59a940a7-673d-47fa-ae81-46c56db884ce	4d04f2f1660b43b959f91cbb5b9f88065dae7f759bc54f83f61350545dd7d73c	2025-12-30 17:36:05.440785+00	20250911201838_add_call_model	\N	\N	2025-12-30 17:36:05.425254+00	1
76360eb8-ac22-4ffa-a2d8-3cfd4185755e	729516de5a28367868f940ada045d88a0504291e2eab9c862fd9e90115e803c4	2025-12-30 17:36:05.567693+00	20251028035215_add_privacy_blur_on_unfocus	\N	\N	2025-12-30 17:36:05.563815+00	1
242a0d2e-c967-4ed7-97cc-8775acd1c89b	a53d0aea77feb002100739f6902603ff49047c1a55071e7c84de2c16c1265db6	2025-12-30 17:36:05.449637+00	20250911205619_add_call_model	\N	\N	2025-12-30 17:36:05.444299+00	1
7e0f25a1-ddb8-4bff-bec1-989c6cf1f3a2	535413630795499457e67882e8c7fafc82b0666d7d69d01d989d18514ec2556d	2025-12-30 17:36:05.461249+00	20250916013603_add_all	\N	\N	2025-12-30 17:36:05.450579+00	1
250fb7d3-283a-4e1c-b2cd-9ce942d7ad41	86960e034a4c6b50abe2c49cf351278431f5dfac98d5c400ab0fca66ff30c9d5	2025-12-30 17:36:05.652176+00	20251122204729_add_voicemail	\N	\N	2025-12-30 17:36:05.641512+00	1
a41f9a95-b4a7-44df-b5c6-a70a6fb60131	2f7dec717bf95a05a0befada8add945a48e5e2792aace4782eec657a6861d8c3	2025-12-30 17:36:05.466029+00	20250918204258_password_reset_tokens	\N	\N	2025-12-30 17:36:05.462097+00	1
9acc409e-f6d4-45fd-9175-805e2e03b5bc	dd94ad3474bb3b480137d617811c7627eab93eb1f2604fd44100037ee9b585ba	2025-12-30 17:36:05.586094+00	20251104045218_add_regional_pricing_fields	\N	\N	2025-12-30 17:36:05.569683+00	1
35416181-1694-45f7-a6f9-9a729ad975af	b8151c534cfecc45c177829f1bbd28708cf64a4176bbbb1d206b460ee0a67ded	2025-12-30 17:36:05.483098+00	20250919023130_add_password_reset_tokens	\N	\N	2025-12-30 17:36:05.466911+00	1
b6c527a7-abed-4663-be98-a456b69f2575	909dbbf23416af080bdc269b9b80b602d344a8033e462258009b6d0e1eeead03	2025-12-30 17:36:05.487627+00	20251003031207_init_chatforia	\N	\N	2025-12-30 17:36:05.484001+00	1
6390ac34-2620-4dce-8ab4-754cec15770c	5932ffe8d674bbb899d949306085dd659808f46a6323f8d239a259196af003e3	2025-12-30 17:36:05.507868+00	20251009021720_fix_2fa_fields	\N	\N	2025-12-30 17:36:05.488447+00	1
6bbf868d-8f88-44ca-b8cf-5f555cff3928	fa91467194d0e85e536e776b78ee7cd5890f49eb76eed1a21fc0df190e97c740	2025-12-30 17:36:05.592178+00	20251105040945_attachments_audio_enhancements	\N	\N	2025-12-30 17:36:05.587136+00	1
08387cd8-74d3-4335-94c3-3e1c41e897fc	dbda1580f4029305ac5a2dccf8213613199ac18bea2ded6c6fcc4388d7e9880a	2025-12-30 17:36:05.514469+00	20251009200250_a11y_prefs	\N	\N	2025-12-30 17:36:05.508879+00	1
e9a6ab69-4079-44d5-b322-9d2e047af2ec	8d25aadca574952fda41c3991c6a5e488b748864289dda3475a7d3f885bed60b	2025-12-30 17:36:05.523877+00	20251009201450_add_a11y_fields	\N	\N	2025-12-30 17:36:05.516237+00	1
1aa8de7b-9c0b-4d2d-af9d-70dcb716f523	a7973e57bb07b3e6d2fdc0a4e07bf632058949a1f177f2d8d05f9d14354a2401	2025-12-30 17:36:05.7101+00	20251216154318_remove_user_private_key	\N	\N	2025-12-30 17:36:05.706045+00	1
e5e9647d-4936-4ff5-96b0-12c05c30d831	6dec0583a8b32d4ba2b309f26972e506cbe5697cff7e82887d4c83f2c62fea2f	2025-12-30 17:36:05.532764+00	20251009203027_add_a11y_prefs	\N	\N	2025-12-30 17:36:05.525068+00	1
cdac6438-2ea0-42f6-a525-ddef2f63692d	5964672a3d97018afba0ee477b69bb57824d2319723b8a1181d2f000f6333824	2025-12-30 17:36:05.60096+00	20251118044438_add_foria_messages	\N	\N	2025-12-30 17:36:05.593057+00	1
95874ae4-24e0-438d-959c-c602e99f38d6	2064545fe89b24c3836328a7127d8555ffa1f7391ac35c6b5980f14d001d5341	2025-12-30 17:36:05.538674+00	20251017221629_add_user_auto_translate	\N	\N	2025-12-30 17:36:05.533706+00	1
59900bb9-14d4-4bc3-a1f2-3edf3fecc044	7c7ce0fe8ced38216cdc1d7b902dec6197491345750a198b485a92a484fbb8e2	2025-12-30 17:36:05.552959+00	20251027234700_add_language_model	\N	\N	2025-12-30 17:36:05.539637+00	1
4781c18f-941a-4519-8d35-5252d035f890	b7b8ef6e09bac1b22a6aea015294612169fd7effefbaf43588de08e2096164d9	2025-12-30 17:36:05.659847+00	20251123054105_add_support_ticket	\N	\N	2025-12-30 17:36:05.653182+00	1
f9a05ecf-5081-483e-a70d-1363c7708052	0c3867d464873fefce7f084fc78c2215e06a655f78cb2709a24f8d59a7cc3593	2025-12-30 17:36:05.562792+00	20251028033337_translations_table	\N	\N	2025-12-30 17:36:05.553988+00	1
a764593b-f14a-43dd-b340-886f78547910	ecc02104ec02c45f230b312a6c435cd6446e975ffe9f795a845a69b35d4bd140	2025-12-30 17:36:05.616216+00	20251120020858_add_family_models_and_teal_iccid	\N	\N	2025-12-30 17:36:05.601788+00	1
b641f39f-a3ed-4c3a-a2a7-db71ede44c62	2e2f7bf8b96b7638f229f0b95616ceb5a685d4fd52e03cbed1fb9c544f31d59b	2025-12-30 17:36:05.625451+00	20251120034353_add_mobile_data_pack_purchase	\N	\N	2025-12-30 17:36:05.61727+00	1
d42047ce-d7f8-4616-b9e6-59e6031f9526	6e7c0588cc75e3391eceba55661a57d060365b7b531f44b559d974da31b51bd3	2025-12-30 17:36:05.631687+00	20251120034617_add_mobile_data_pack_purchase	\N	\N	2025-12-30 17:36:05.626433+00	1
4b368489-477a-4480-87e1-c2179831eac2	53d5494925f0de0c66147bef75724e80fa42a607e45fded9b6b75d970e367588	2025-12-30 17:36:05.669936+00	20251123055227_add_ad_inquiry	\N	\N	2025-12-30 17:36:05.660866+00	1
e1465e14-9a0b-4aa2-89ad-29b0cbea6265	ecddef1528d8fc5ab0848e5710bf9217544d518b96eb65ea90e3f9ff21f7713b	2025-12-30 17:36:05.640535+00	20251120040441_add_mobile_data_pack_purchase	\N	\N	2025-12-30 17:36:05.632739+00	1
1e631f5b-f938-4714-8191-192c74a2ea11	a76deafc3fab39c08367d94810f5043e54318945b05ab2e27bd60833cd9f0d88	2025-12-30 17:36:05.688868+00	20251127003302_add_voice_log	\N	\N	2025-12-30 17:36:05.670989+00	1
cf80312b-c290-4019-8ddb-b10c0e31fa61	baa0def637257f0ef01ec1b8c4fc21248ac54961a0b16b70db4c5be9f3c03f0b	2025-12-30 17:36:05.714674+00	20251217222623_add_phone_country_caps	\N	\N	2025-12-30 17:36:05.710941+00	1
23126d63-ae24-4025-a35f-dd8e0f062cd1	1123946e50a6769fc169ac4af06c852d9c158a8d1528c511b4c6bdec9b1210c7	2025-12-30 17:36:05.694499+00	20251127005047_add_voice_log	\N	\N	2025-12-30 17:36:05.689865+00	1
2f8daae7-ec0a-44ad-8fcc-2bcb1a8cb137	a1cc26f4beeb70ecec1fa834beb61e07038e1a08ae64b3cb8f8ff529943f330a	2025-12-30 17:36:05.705174+00	20251127193544_add_forwarding_fields_to_user	\N	\N	2025-12-30 17:36:05.695461+00	1
d1d09b6a-a437-4c74-b3d1-4d2a00cff88b	318a2f88e20b54fbc1d56f2a5dd73acb5c0b6176d7c19548fdddeae83e14abb2	2025-12-30 17:36:05.758751+00	20251223000829_add_sms_edited_at	\N	\N	2025-12-30 17:36:05.754035+00	1
5e92d065-613b-439f-9e36-7b3ab73cb660	19a88219f6580e264182b4884e754fa45c26bd5986610dec9f6fb52c3f9aa105	2025-12-30 17:36:05.720138+00	20251218022900_add_phone_number_for_sale	\N	\N	2025-12-30 17:36:05.715484+00	1
6c2cc5ae-c201-46e6-a3c7-3f34b6725adb	49bf067397329dc8405a2d29fa2afee4574f3c1e91a8b196c0bb3f42932b62b8	2025-12-30 17:36:05.752478+00	20251222233259_add_smsmessage_edited_at	\N	\N	2025-12-30 17:36:05.741789+00	1
5fc958d8-bdc1-4e7e-aea7-31df2b795f9a	5cc6c83810006c9f09c48f05318468aa98ae05037d410a8fd01fcf0ef5b6a181	2025-12-30 17:36:05.73468+00	20251221192126_message_deletes	\N	\N	2025-12-30 17:36:05.725932+00	1
b1c4c5a6-c42d-497b-9f79-c00d00994610	1ab8e61f7fde3b62386520150b89a281bf415c93d7ce7fa1a6210f9b6559c43f	2025-12-30 17:36:05.740344+00	20251221213953_archive	\N	\N	2025-12-30 17:36:05.735465+00	1
88283c7f-f6dc-4e79-97d4-e3833c79e980	5a6836614ca2431e653eb633f639a6314e3efc1260433be56a8c37137f36b60d	2026-04-14 01:08:16.876792+00	20251225175751_participant_cleared_at	\N	\N	2026-04-14 01:08:16.844231+00	1
5e6edee5-c8b6-4750-b511-d509e3d5aaf8	472a815dd049dfcc880fd49e69bd061f8b3d84e7bd8fcccbc2a1807515eb9994	2026-04-14 01:08:16.911693+00	20251225183918_thread_clear_table	\N	\N	2026-04-14 01:08:16.877966+00	1
b202068b-85de-4a0e-800c-97f19a279a24	554bee2238a83a03dc33358580157ada215a666fad20f14c4801b9133a080224	2026-04-14 01:08:16.916813+00	20260210192653_add_client_message_id_to_message	\N	\N	2026-04-14 01:08:16.912731+00	1
694b9db0-6700-4e05-997b-92984f712b54	dec58477733a8d015b462fd3ea81471fee900714570c789caf843af8b9111694	2026-04-14 01:08:16.921354+00	20260211043359_add_edited_at_to_message	\N	\N	2026-04-14 01:08:16.917859+00	1
59a164cf-e839-45fa-a115-45930aa3e8cd	4d04c8627e13ffcc564c6b467cd0d8beb4c1db00a40d1a4975306c0846d6561f	2026-04-14 01:08:16.927762+00	20260211043733_add_thumb_url_to_message_attachment	\N	\N	2026-04-14 01:08:16.9228+00	1
629d0ef8-c16e-4d1f-8528-c70b2157fe8b	1fdc453dd9a8bef0a3fe1351ef4aa672a48f863b9639cdf43fdfa859c40476c5	2026-04-14 18:20:28.636968+00	20260325231528_voicemail_call_link	\N	\N	2026-04-14 18:20:28.628237+00	1
26f79d34-f22a-4e95-9377-4950ac6fa3be	ea48b4157133ca3eb23140269c4e91e45763ac0b774df4aaddbc8cb68130b961	2026-04-14 01:08:16.972181+00	20260214214252_add_message_reads	\N	\N	2026-04-14 01:08:16.92894+00	1
f6fb7b33-f83a-4227-9695-4e895efaa140	56456f9492de76fdc17c3869f4c6eeac3cc667323a3d6e8e36de851b891e8e63	2026-04-14 18:19:18.995435+00	20260321035133_add_sms_thread_deleted_at	\N	\N	2026-04-14 18:19:18.991698+00	1
1c3b8168-3359-44f8-b833-77257eb29a13	e503adfc24660e126159ce9ad65e21738b9dd44ee95987409e7d900a8e7c2eb7	2026-04-14 01:08:16.978781+00	20260215201412_add_message_read_receipts	\N	\N	2026-04-14 01:08:16.973393+00	1
7ad4ac44-f1ae-490e-a7a7-3d7239f3aa1e	ee5ed35971465e8609f790c69587b1453f9d708f39599699c7a330aacbcc0a6e	2026-04-14 01:08:17.070749+00	20260310010954_init	\N	\N	2026-04-14 01:08:16.98004+00	1
93a12bb9-e282-4624-99c2-02c7a1f893c5	66c80ec6fdd391ba0d9c2efe7e8dea1f8b3e53c9d1284f714f62218ce6b7c477	\N	20260310212720_rename_password_to_passwordhash	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20260310212720_rename_password_to_passwordhash\n\nDatabase error code: 23502\n\nDatabase error:\nERROR: column "passwordHash" of relation "User" contains null values\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E23502), message: "column \\"passwordHash\\" of relation \\"User\\" contains null values", detail: None, hint: None, position: None, where_: None, schema: Some("public"), table: Some("User"), column: Some("passwordHash"), datatype: None, constraint: None, file: Some("tablecmds.c"), line: Some(6456), routine: Some("ATRewriteTable") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20260310212720_rename_password_to_passwordhash"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20260310212720_rename_password_to_passwordhash"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:260	2026-04-14 18:19:10.10704+00	2026-04-14 01:08:17.072231+00	0
e559fd15-1060-426e-b52f-4aab39a9d8d5	66c80ec6fdd391ba0d9c2efe7e8dea1f8b3e53c9d1284f714f62218ce6b7c477	2026-04-14 18:19:10.114613+00	20260310212720_rename_password_to_passwordhash		\N	2026-04-14 18:19:10.114613+00	0
f33cce84-58e4-448e-a69b-33e6d03a4cfa	36ee11383078487bd2b9745560b0a8b947398e2b97babe13f8a278cd7b2d34f1	\N	20260325214859_add_display_name_to_user	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20260325214859_add_display_name_to_user\n\nDatabase error code: 42701\n\nDatabase error:\nERROR: column "displayName" of relation "User" already exists\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42701), message: "column \\"displayName\\" of relation \\"User\\" already exists", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("tablecmds.c"), line: Some(7686), routine: Some("check_for_column_name_collision") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20260325214859_add_display_name_to_user"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20260325214859_add_display_name_to_user"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:244	2026-04-14 18:20:23.411593+00	2026-04-14 18:19:18.996971+00	0
a28fed92-824d-441e-9067-7daf87074dea	92858675ae37f81bf21a2b287b155cabe80fe63d54203d3639d96c778693a87e	2026-04-14 18:19:18.914355+00	20260315040817_add_device_identity	\N	\N	2026-04-14 18:19:18.900636+00	1
21892f5f-9c8b-4c5a-b4a1-f30fc334d625	36ee11383078487bd2b9745560b0a8b947398e2b97babe13f8a278cd7b2d34f1	2026-04-14 18:20:23.413778+00	20260325214859_add_display_name_to_user		\N	2026-04-14 18:20:23.413778+00	0
c45796bd-f1fb-4f7f-976f-e6508944b3bf	b76228208e4c3ef7fec5c93c218b95fb4c65f0fefaf2bb7e3459bb3483a24a9b	2026-04-14 18:19:18.955829+00	20260317163502_add_iccid_to_user	\N	\N	2026-04-14 18:19:18.915629+00	1
790e6c4c-4c9a-4b2c-8de0-2d428c257375	e9e1427ee660042db052d74fbb06d2f9d064a80e61668bf1fbb933eb1c9e4e7a	2026-04-14 18:19:18.990789+00	20260321033914_add_thread_state	\N	\N	2026-04-14 18:19:18.957096+00	1
7114920d-c46f-44ad-818f-09fab491c317	b098b0d6c4109c88d03181699e5bdf5dcc8f680d6f077e05658b7ca35b14e876	2026-04-14 18:20:28.65405+00	20260325235309_invite_link	\N	\N	2026-04-14 18:20:28.638407+00	1
ccf9bea5-c7fe-44f4-b265-1dc9598f2bcf	4d1acbfba1c582f4178112d9537c1cb281b3a6b5a459721481a21633d53cea82	2026-04-14 18:20:28.670989+00	20260404031015_paddle_billing_fields	\N	\N	2026-04-14 18:20:28.655356+00	1
e32d732a-5d4d-40b0-9404-4d49a3714e14	c29ad23f58e47c817404df5e1ff9fdf712f9961248ba1c501958da1f8bd84707	2026-04-14 18:20:28.679097+00	20260408022356_add_ui_language	\N	\N	2026-04-14 18:20:28.672233+00	1
32520bff-6940-4384-bf15-af176c6d7e46	7c68eb7633d6e7fe2cea3b2eb21f1eb45641d2abf6efdaca1c9f1f642c4dbcfc	\N	20260412204734_add_oauth_fields	A migration failed to apply. New migrations cannot be applied before the error is recovered from. Read more about how to resolve migration issues in a production database: https://pris.ly/d/migrate-resolve\n\nMigration name: 20260412204734_add_oauth_fields\n\nDatabase error code: 42701\n\nDatabase error:\nERROR: column "appleSub" of relation "User" already exists\n\nDbError { severity: "ERROR", parsed_severity: Some(Error), code: SqlState(E42701), message: "column \\"appleSub\\" of relation \\"User\\" already exists", detail: None, hint: None, position: None, where_: None, schema: None, table: None, column: None, datatype: None, constraint: None, file: Some("tablecmds.c"), line: Some(7686), routine: Some("check_for_column_name_collision") }\n\n   0: sql_schema_connector::apply_migration::apply_script\n           with migration_name="20260412204734_add_oauth_fields"\n             at schema-engine/connectors/sql-schema-connector/src/apply_migration.rs:113\n   1: schema_commands::commands::apply_migrations::Applying migration\n           with migration_name="20260412204734_add_oauth_fields"\n             at schema-engine/commands/src/commands/apply_migrations.rs:95\n   2: schema_core::state::ApplyMigrations\n             at schema-engine/core/src/state.rs:244	2026-04-14 18:21:09.699099+00	2026-04-14 18:20:28.680438+00	0
681b9c97-1819-47d6-9cdf-1f6fb06d605c	7c68eb7633d6e7fe2cea3b2eb21f1eb45641d2abf6efdaca1c9f1f642c4dbcfc	2026-04-14 18:21:09.703075+00	20260412204734_add_oauth_fields		\N	2026-04-14 18:21:09.703075+00	0
\.


--
-- Name: AdInquiry_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."AdInquiry_id_seq"', 1, false);


--
-- Name: AuditLog_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."AuditLog_id_seq"', 1, false);


--
-- Name: BotEventLog_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."BotEventLog_id_seq"', 1, false);


--
-- Name: BotInstall_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."BotInstall_id_seq"', 1, false);


--
-- Name: Bot_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."Bot_id_seq"', 1, false);


--
-- Name: Call_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."Call_id_seq"', 1, false);


--
-- Name: ChatRoomInvite_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."ChatRoomInvite_id_seq"', 1, false);


--
-- Name: ChatRoom_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."ChatRoom_id_seq"', 1, false);


--
-- Name: Contact_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."Contact_id_seq"', 1, false);


--
-- Name: FamilyGroup_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."FamilyGroup_id_seq"', 1, false);


--
-- Name: FamilyInvite_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."FamilyInvite_id_seq"', 1, false);


--
-- Name: FamilyMember_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."FamilyMember_id_seq"', 1, false);


--
-- Name: Follow_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."Follow_id_seq"', 1, false);


--
-- Name: ForiaMessage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."ForiaMessage_id_seq"', 1, false);


--
-- Name: Language_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."Language_id_seq"', 1, false);


--
-- Name: MessageAttachment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."MessageAttachment_id_seq"', 1, false);


--
-- Name: MessageDeletion_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."MessageDeletion_id_seq"', 1, false);


--
-- Name: Message_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."Message_id_seq"', 1, false);


--
-- Name: MobileDataPackPurchase_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."MobileDataPackPurchase_id_seq"', 1, false);


--
-- Name: NumberReservation_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."NumberReservation_id_seq"', 1, false);


--
-- Name: Participant_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."Participant_id_seq"', 1, false);


--
-- Name: PasswordResetToken_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."PasswordResetToken_id_seq"', 1, false);


--
-- Name: PeopleInvite_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."PeopleInvite_id_seq"', 1, false);


--
-- Name: PhoneNumber_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."PhoneNumber_id_seq"', 1, false);


--
-- Name: PhoneOtp_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."PhoneOtp_id_seq"', 1, false);


--
-- Name: PhoneVerificationRequest_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."PhoneVerificationRequest_id_seq"', 1, false);


--
-- Name: Phone_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."Phone_id_seq"', 1, false);


--
-- Name: RandomChatRoom_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."RandomChatRoom_id_seq"', 1, false);


--
-- Name: Report_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."Report_id_seq"', 1, false);


--
-- Name: STTUsage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."STTUsage_id_seq"', 1, false);


--
-- Name: ScheduledMessage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."ScheduledMessage_id_seq"', 1, false);


--
-- Name: SmsCarrierEvent_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."SmsCarrierEvent_id_seq"', 1, false);


--
-- Name: SmsConsent_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."SmsConsent_id_seq"', 1, false);


--
-- Name: SmsMessage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."SmsMessage_id_seq"', 1, false);


--
-- Name: SmsOptOut_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."SmsOptOut_id_seq"', 1, false);


--
-- Name: SmsParticipant_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."SmsParticipant_id_seq"', 1, false);


--
-- Name: SmsThread_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."SmsThread_id_seq"', 1, false);


--
-- Name: StatusAsset_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."StatusAsset_id_seq"', 1, false);


--
-- Name: StatusView_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."StatusView_id_seq"', 1, false);


--
-- Name: Status_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."Status_id_seq"', 1, false);


--
-- Name: Subscriber_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."Subscriber_id_seq"', 1, false);


--
-- Name: SupportTicket_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."SupportTicket_id_seq"', 1, false);


--
-- Name: Translation_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."Translation_id_seq"', 1, false);


--
-- Name: TwoFactorRecoveryCode_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."TwoFactorRecoveryCode_id_seq"', 1, false);


--
-- Name: Upload_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."Upload_id_seq"', 1, false);


--
-- Name: User_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."User_id_seq"', 33, true);


--
-- Name: VerificationToken_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."VerificationToken_id_seq"', 18, true);


--
-- Name: VoiceLog_id_seq; Type: SEQUENCE SET; Schema: public; Owner: doadmin
--

SELECT pg_catalog.setval('public."VoiceLog_id_seq"', 1, false);


--
-- Name: AdInquiry AdInquiry_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."AdInquiry"
    ADD CONSTRAINT "AdInquiry_pkey" PRIMARY KEY (id);


--
-- Name: AuditLog AuditLog_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY (id);


--
-- Name: BotEventLog BotEventLog_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."BotEventLog"
    ADD CONSTRAINT "BotEventLog_pkey" PRIMARY KEY (id);


--
-- Name: BotInstall BotInstall_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."BotInstall"
    ADD CONSTRAINT "BotInstall_pkey" PRIMARY KEY (id);


--
-- Name: Bot Bot_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Bot"
    ADD CONSTRAINT "Bot_pkey" PRIMARY KEY (id);


--
-- Name: Call Call_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Call"
    ADD CONSTRAINT "Call_pkey" PRIMARY KEY (id);


--
-- Name: ChatRoomInvite ChatRoomInvite_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ChatRoomInvite"
    ADD CONSTRAINT "ChatRoomInvite_pkey" PRIMARY KEY (id);


--
-- Name: ChatRoom ChatRoom_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ChatRoom"
    ADD CONSTRAINT "ChatRoom_pkey" PRIMARY KEY (id);


--
-- Name: Contact Contact_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Contact"
    ADD CONSTRAINT "Contact_pkey" PRIMARY KEY (id);


--
-- Name: Device Device_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Device"
    ADD CONSTRAINT "Device_pkey" PRIMARY KEY (id);


--
-- Name: FamilyGroup FamilyGroup_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."FamilyGroup"
    ADD CONSTRAINT "FamilyGroup_pkey" PRIMARY KEY (id);


--
-- Name: FamilyInvite FamilyInvite_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."FamilyInvite"
    ADD CONSTRAINT "FamilyInvite_pkey" PRIMARY KEY (id);


--
-- Name: FamilyMember FamilyMember_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."FamilyMember"
    ADD CONSTRAINT "FamilyMember_pkey" PRIMARY KEY (id);


--
-- Name: Follow Follow_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Follow"
    ADD CONSTRAINT "Follow_pkey" PRIMARY KEY (id);


--
-- Name: ForiaMessage ForiaMessage_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ForiaMessage"
    ADD CONSTRAINT "ForiaMessage_pkey" PRIMARY KEY (id);


--
-- Name: Language Language_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Language"
    ADD CONSTRAINT "Language_pkey" PRIMARY KEY (id);


--
-- Name: MessageAttachment MessageAttachment_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageAttachment"
    ADD CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY (id);


--
-- Name: MessageDeletion MessageDeletion_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageDeletion"
    ADD CONSTRAINT "MessageDeletion_pkey" PRIMARY KEY (id);


--
-- Name: MessageKey MessageKey_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageKey"
    ADD CONSTRAINT "MessageKey_pkey" PRIMARY KEY ("messageId", "userId");


--
-- Name: MessageReaction MessageReaction_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageReaction"
    ADD CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("messageId", "userId", emoji);


--
-- Name: MessageRead MessageRead_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageRead"
    ADD CONSTRAINT "MessageRead_pkey" PRIMARY KEY ("messageId", "userId");


--
-- Name: MessageSessionKey MessageSessionKey_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageSessionKey"
    ADD CONSTRAINT "MessageSessionKey_pkey" PRIMARY KEY (id);


--
-- Name: Message Message_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Message"
    ADD CONSTRAINT "Message_pkey" PRIMARY KEY (id);


--
-- Name: MobileDataPackPurchase MobileDataPackPurchase_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MobileDataPackPurchase"
    ADD CONSTRAINT "MobileDataPackPurchase_pkey" PRIMARY KEY (id);


--
-- Name: NumberReservation NumberReservation_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."NumberReservation"
    ADD CONSTRAINT "NumberReservation_pkey" PRIMARY KEY (id);


--
-- Name: Participant Participant_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Participant"
    ADD CONSTRAINT "Participant_pkey" PRIMARY KEY (id);


--
-- Name: PasswordResetToken PasswordResetToken_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY (id);


--
-- Name: PeopleInvite PeopleInvite_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PeopleInvite"
    ADD CONSTRAINT "PeopleInvite_pkey" PRIMARY KEY (id);


--
-- Name: PhoneNumber PhoneNumber_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PhoneNumber"
    ADD CONSTRAINT "PhoneNumber_pkey" PRIMARY KEY (id);


--
-- Name: PhoneOtp PhoneOtp_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PhoneOtp"
    ADD CONSTRAINT "PhoneOtp_pkey" PRIMARY KEY (id);


--
-- Name: PhoneVerificationRequest PhoneVerificationRequest_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PhoneVerificationRequest"
    ADD CONSTRAINT "PhoneVerificationRequest_pkey" PRIMARY KEY (id);


--
-- Name: Phone Phone_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Phone"
    ADD CONSTRAINT "Phone_pkey" PRIMARY KEY (id);


--
-- Name: PortRequest PortRequest_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PortRequest"
    ADD CONSTRAINT "PortRequest_pkey" PRIMARY KEY (id);


--
-- Name: PriceOverride PriceOverride_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PriceOverride"
    ADD CONSTRAINT "PriceOverride_pkey" PRIMARY KEY (id);


--
-- Name: Price Price_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Price"
    ADD CONSTRAINT "Price_pkey" PRIMARY KEY (id);


--
-- Name: ProvisionLink ProvisionLink_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ProvisionLink"
    ADD CONSTRAINT "ProvisionLink_pkey" PRIMARY KEY (id);


--
-- Name: RandomChatRoom RandomChatRoom_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."RandomChatRoom"
    ADD CONSTRAINT "RandomChatRoom_pkey" PRIMARY KEY (id);


--
-- Name: RegionRule RegionRule_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."RegionRule"
    ADD CONSTRAINT "RegionRule_pkey" PRIMARY KEY (id);


--
-- Name: Report Report_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Report"
    ADD CONSTRAINT "Report_pkey" PRIMARY KEY (id);


--
-- Name: STTUsage STTUsage_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."STTUsage"
    ADD CONSTRAINT "STTUsage_pkey" PRIMARY KEY (id);


--
-- Name: ScheduledMessage ScheduledMessage_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ScheduledMessage"
    ADD CONSTRAINT "ScheduledMessage_pkey" PRIMARY KEY (id);


--
-- Name: SmsCarrierEvent SmsCarrierEvent_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsCarrierEvent"
    ADD CONSTRAINT "SmsCarrierEvent_pkey" PRIMARY KEY (id);


--
-- Name: SmsConsent SmsConsent_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsConsent"
    ADD CONSTRAINT "SmsConsent_pkey" PRIMARY KEY (id);


--
-- Name: SmsMessage SmsMessage_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsMessage"
    ADD CONSTRAINT "SmsMessage_pkey" PRIMARY KEY (id);


--
-- Name: SmsOptOut SmsOptOut_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsOptOut"
    ADD CONSTRAINT "SmsOptOut_pkey" PRIMARY KEY (id);


--
-- Name: SmsParticipant SmsParticipant_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsParticipant"
    ADD CONSTRAINT "SmsParticipant_pkey" PRIMARY KEY (id);


--
-- Name: SmsThread SmsThread_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsThread"
    ADD CONSTRAINT "SmsThread_pkey" PRIMARY KEY (id);


--
-- Name: StatusAsset StatusAsset_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."StatusAsset"
    ADD CONSTRAINT "StatusAsset_pkey" PRIMARY KEY (id);


--
-- Name: StatusKey StatusKey_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."StatusKey"
    ADD CONSTRAINT "StatusKey_pkey" PRIMARY KEY ("statusId", "userId");


--
-- Name: StatusReaction StatusReaction_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."StatusReaction"
    ADD CONSTRAINT "StatusReaction_pkey" PRIMARY KEY ("statusId", "userId", emoji);


--
-- Name: StatusView StatusView_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."StatusView"
    ADD CONSTRAINT "StatusView_pkey" PRIMARY KEY (id);


--
-- Name: Status Status_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Status"
    ADD CONSTRAINT "Status_pkey" PRIMARY KEY (id);


--
-- Name: Subscriber Subscriber_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Subscriber"
    ADD CONSTRAINT "Subscriber_pkey" PRIMARY KEY (id);


--
-- Name: SupportTicket SupportTicket_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SupportTicket"
    ADD CONSTRAINT "SupportTicket_pkey" PRIMARY KEY (id);


--
-- Name: Transcript Transcript_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Transcript"
    ADD CONSTRAINT "Transcript_pkey" PRIMARY KEY (id);


--
-- Name: Translation Translation_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Translation"
    ADD CONSTRAINT "Translation_pkey" PRIMARY KEY (id);


--
-- Name: TwoFactorRecoveryCode TwoFactorRecoveryCode_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."TwoFactorRecoveryCode"
    ADD CONSTRAINT "TwoFactorRecoveryCode_pkey" PRIMARY KEY (id);


--
-- Name: Upload Upload_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Upload"
    ADD CONSTRAINT "Upload_pkey" PRIMARY KEY (id);


--
-- Name: User User_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."User"
    ADD CONSTRAINT "User_pkey" PRIMARY KEY (id);


--
-- Name: VerificationToken VerificationToken_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."VerificationToken"
    ADD CONSTRAINT "VerificationToken_pkey" PRIMARY KEY (id);


--
-- Name: VoiceLog VoiceLog_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."VoiceLog"
    ADD CONSTRAINT "VoiceLog_pkey" PRIMARY KEY (id);


--
-- Name: Voicemail Voicemail_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Voicemail"
    ADD CONSTRAINT "Voicemail_pkey" PRIMARY KEY (id);


--
-- Name: _RandomChatParticipants _RandomChatParticipants_AB_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."_RandomChatParticipants"
    ADD CONSTRAINT "_RandomChatParticipants_AB_pkey" PRIMARY KEY ("A", "B");


--
-- Name: _ReadMessages _ReadMessages_AB_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."_ReadMessages"
    ADD CONSTRAINT "_ReadMessages_AB_pkey" PRIMARY KEY ("A", "B");


--
-- Name: _prisma_migrations _prisma_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public._prisma_migrations
    ADD CONSTRAINT _prisma_migrations_pkey PRIMARY KEY (id);


--
-- Name: AuditLog_action_createdAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "AuditLog_action_createdAt_idx" ON public."AuditLog" USING btree (action, "createdAt");


--
-- Name: AuditLog_actorId_createdAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "AuditLog_actorId_createdAt_idx" ON public."AuditLog" USING btree ("actorId", "createdAt");


--
-- Name: BotEventLog_eventId_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "BotEventLog_eventId_key" ON public."BotEventLog" USING btree ("eventId");


--
-- Name: BotEventLog_installId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "BotEventLog_installId_idx" ON public."BotEventLog" USING btree ("installId");


--
-- Name: BotInstall_botId_chatRoomId_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "BotInstall_botId_chatRoomId_key" ON public."BotInstall" USING btree ("botId", "chatRoomId");


--
-- Name: Bot_ownerId_name_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "Bot_ownerId_name_key" ON public."Bot" USING btree ("ownerId", name);


--
-- Name: Call_calleeId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Call_calleeId_idx" ON public."Call" USING btree ("calleeId");


--
-- Name: Call_callerId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Call_callerId_idx" ON public."Call" USING btree ("callerId");


--
-- Name: Call_roomId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Call_roomId_idx" ON public."Call" USING btree ("roomId");


--
-- Name: ChatRoomInvite_code_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "ChatRoomInvite_code_key" ON public."ChatRoomInvite" USING btree (code);


--
-- Name: ChatRoom_ownerId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "ChatRoom_ownerId_idx" ON public."ChatRoom" USING btree ("ownerId");


--
-- Name: Contact_ownerId_externalPhone_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "Contact_ownerId_externalPhone_key" ON public."Contact" USING btree ("ownerId", "externalPhone");


--
-- Name: Contact_ownerId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Contact_ownerId_idx" ON public."Contact" USING btree ("ownerId");


--
-- Name: Contact_ownerId_userId_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "Contact_ownerId_userId_key" ON public."Contact" USING btree ("ownerId", "userId");


--
-- Name: Contact_userId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Contact_userId_idx" ON public."Contact" USING btree ("userId");


--
-- Name: Device_userId_deviceId_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "Device_userId_deviceId_key" ON public."Device" USING btree ("userId", "deviceId");


--
-- Name: Device_userId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Device_userId_idx" ON public."Device" USING btree ("userId");


--
-- Name: Device_userId_pairingStatus_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Device_userId_pairingStatus_idx" ON public."Device" USING btree ("userId", "pairingStatus");


--
-- Name: Device_userId_revokedAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Device_userId_revokedAt_idx" ON public."Device" USING btree ("userId", "revokedAt");


--
-- Name: FamilyInvite_token_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "FamilyInvite_token_key" ON public."FamilyInvite" USING btree (token);


--
-- Name: Follow_followerId_followingId_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON public."Follow" USING btree ("followerId", "followingId");


--
-- Name: Follow_followingId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Follow_followingId_idx" ON public."Follow" USING btree ("followingId");


--
-- Name: ForiaMessage_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "ForiaMessage_userId_createdAt_idx" ON public."ForiaMessage" USING btree ("userId", "createdAt");


--
-- Name: Language_code_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "Language_code_key" ON public."Language" USING btree (code);


--
-- Name: MessageAttachment_deletedAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "MessageAttachment_deletedAt_idx" ON public."MessageAttachment" USING btree ("deletedAt");


--
-- Name: MessageAttachment_kind_messageId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "MessageAttachment_kind_messageId_idx" ON public."MessageAttachment" USING btree (kind, "messageId");


--
-- Name: MessageAttachment_messageId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "MessageAttachment_messageId_idx" ON public."MessageAttachment" USING btree ("messageId");


--
-- Name: MessageDeletion_messageId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "MessageDeletion_messageId_idx" ON public."MessageDeletion" USING btree ("messageId");


--
-- Name: MessageDeletion_messageId_userId_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "MessageDeletion_messageId_userId_key" ON public."MessageDeletion" USING btree ("messageId", "userId");


--
-- Name: MessageDeletion_userId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "MessageDeletion_userId_idx" ON public."MessageDeletion" USING btree ("userId");


--
-- Name: MessageKey_userId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "MessageKey_userId_idx" ON public."MessageKey" USING btree ("userId");


--
-- Name: MessageReaction_messageId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "MessageReaction_messageId_idx" ON public."MessageReaction" USING btree ("messageId");


--
-- Name: MessageReaction_userId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "MessageReaction_userId_idx" ON public."MessageReaction" USING btree ("userId");


--
-- Name: MessageRead_messageId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "MessageRead_messageId_idx" ON public."MessageRead" USING btree ("messageId");


--
-- Name: MessageRead_userId_readAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "MessageRead_userId_readAt_idx" ON public."MessageRead" USING btree ("userId", "readAt");


--
-- Name: MessageSessionKey_messageId_recipientUserId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "MessageSessionKey_messageId_recipientUserId_idx" ON public."MessageSessionKey" USING btree ("messageId", "recipientUserId");


--
-- Name: MessageSessionKey_recipientDeviceId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "MessageSessionKey_recipientDeviceId_idx" ON public."MessageSessionKey" USING btree ("recipientDeviceId");


--
-- Name: MessageSessionKey_recipientUserId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "MessageSessionKey_recipientUserId_idx" ON public."MessageSessionKey" USING btree ("recipientUserId");


--
-- Name: Message_expiresAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Message_expiresAt_idx" ON public."Message" USING btree ("expiresAt");


--
-- Name: NumberReservation_expiresAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "NumberReservation_expiresAt_idx" ON public."NumberReservation" USING btree ("expiresAt");


--
-- Name: Participant_chatRoomId_userId_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "Participant_chatRoomId_userId_key" ON public."Participant" USING btree ("chatRoomId", "userId");


--
-- Name: PasswordResetToken_expiresAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PasswordResetToken_expiresAt_idx" ON public."PasswordResetToken" USING btree ("expiresAt");


--
-- Name: PasswordResetToken_tokenHash_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PasswordResetToken_tokenHash_idx" ON public."PasswordResetToken" USING btree ("tokenHash");


--
-- Name: PasswordResetToken_userId_usedAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PasswordResetToken_userId_usedAt_idx" ON public."PasswordResetToken" USING btree ("userId", "usedAt");


--
-- Name: PeopleInvite_acceptedByUserId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PeopleInvite_acceptedByUserId_idx" ON public."PeopleInvite" USING btree ("acceptedByUserId");


--
-- Name: PeopleInvite_code_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "PeopleInvite_code_key" ON public."PeopleInvite" USING btree (code);


--
-- Name: PeopleInvite_inviterUserId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PeopleInvite_inviterUserId_idx" ON public."PeopleInvite" USING btree ("inviterUserId");


--
-- Name: PeopleInvite_targetPhone_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PeopleInvite_targetPhone_idx" ON public."PeopleInvite" USING btree ("targetPhone");


--
-- Name: PhoneNumber_assignedUserId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PhoneNumber_assignedUserId_idx" ON public."PhoneNumber" USING btree ("assignedUserId");


--
-- Name: PhoneNumber_e164_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "PhoneNumber_e164_key" ON public."PhoneNumber" USING btree (e164);


--
-- Name: PhoneNumber_isoCountry_areaCode_status_forSale_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PhoneNumber_isoCountry_areaCode_status_forSale_idx" ON public."PhoneNumber" USING btree ("isoCountry", "areaCode", status, "forSale");


--
-- Name: PhoneNumber_isoCountry_status_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PhoneNumber_isoCountry_status_idx" ON public."PhoneNumber" USING btree ("isoCountry", status);


--
-- Name: PhoneNumber_provider_areaCode_status_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PhoneNumber_provider_areaCode_status_idx" ON public."PhoneNumber" USING btree (provider, "areaCode", status);


--
-- Name: PhoneNumber_provider_isoCountry_areaCode_status_forSale_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PhoneNumber_provider_isoCountry_areaCode_status_forSale_idx" ON public."PhoneNumber" USING btree (provider, "isoCountry", "areaCode", status, "forSale");


--
-- Name: PhoneNumber_status_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PhoneNumber_status_idx" ON public."PhoneNumber" USING btree (status);


--
-- Name: PhoneOtp_phone_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PhoneOtp_phone_idx" ON public."PhoneOtp" USING btree (phone);


--
-- Name: PhoneVerificationRequest_phoneId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "PhoneVerificationRequest_phoneId_idx" ON public."PhoneVerificationRequest" USING btree ("phoneId");


--
-- Name: PhoneVerificationRequest_phoneVerificationId_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "PhoneVerificationRequest_phoneVerificationId_key" ON public."PhoneVerificationRequest" USING btree ("phoneVerificationId");


--
-- Name: Phone_number_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "Phone_number_key" ON public."Phone" USING btree (number);


--
-- Name: Phone_userId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Phone_userId_idx" ON public."Phone" USING btree ("userId");


--
-- Name: Price_product_tier_currency_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Price_product_tier_currency_idx" ON public."Price" USING btree (product, tier, currency);


--
-- Name: Price_product_tier_currency_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "Price_product_tier_currency_key" ON public."Price" USING btree (product, tier, currency);


--
-- Name: Price_stripePriceId_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "Price_stripePriceId_key" ON public."Price" USING btree ("stripePriceId");


--
-- Name: ProvisionLink_userId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "ProvisionLink_userId_idx" ON public."ProvisionLink" USING btree ("userId");


--
-- Name: RegionRule_countryCode_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "RegionRule_countryCode_key" ON public."RegionRule" USING btree ("countryCode");


--
-- Name: Report_autoHidden_createdAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Report_autoHidden_createdAt_idx" ON public."Report" USING btree ("autoHidden", "createdAt");


--
-- Name: Report_chatRoomId_createdAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Report_chatRoomId_createdAt_idx" ON public."Report" USING btree ("chatRoomId", "createdAt");


--
-- Name: Report_priority_createdAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Report_priority_createdAt_idx" ON public."Report" USING btree (priority, "createdAt");


--
-- Name: Report_reportedUserId_createdAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Report_reportedUserId_createdAt_idx" ON public."Report" USING btree ("reportedUserId", "createdAt");


--
-- Name: Report_reporterId_createdAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Report_reporterId_createdAt_idx" ON public."Report" USING btree ("reporterId", "createdAt");


--
-- Name: Report_severityScore_createdAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Report_severityScore_createdAt_idx" ON public."Report" USING btree ("severityScore", "createdAt");


--
-- Name: Report_status_createdAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Report_status_createdAt_idx" ON public."Report" USING btree (status, "createdAt");


--
-- Name: STTUsage_monthKey_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "STTUsage_monthKey_idx" ON public."STTUsage" USING btree ("monthKey");


--
-- Name: STTUsage_userId_monthKey_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "STTUsage_userId_monthKey_key" ON public."STTUsage" USING btree ("userId", "monthKey");


--
-- Name: STTUsage_userId_updatedAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "STTUsage_userId_updatedAt_idx" ON public."STTUsage" USING btree ("userId", "updatedAt");


--
-- Name: ScheduledMessage_chatRoomId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "ScheduledMessage_chatRoomId_idx" ON public."ScheduledMessage" USING btree ("chatRoomId");


--
-- Name: ScheduledMessage_scheduledAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "ScheduledMessage_scheduledAt_idx" ON public."ScheduledMessage" USING btree ("scheduledAt");


--
-- Name: ScheduledMessage_senderId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "ScheduledMessage_senderId_idx" ON public."ScheduledMessage" USING btree ("senderId");


--
-- Name: SmsConsent_phone_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "SmsConsent_phone_idx" ON public."SmsConsent" USING btree (phone);


--
-- Name: SmsMessage_phoneId_createdAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "SmsMessage_phoneId_createdAt_idx" ON public."SmsMessage" USING btree ("phoneId", "createdAt");


--
-- Name: SmsMessage_providerMessageId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "SmsMessage_providerMessageId_idx" ON public."SmsMessage" USING btree ("providerMessageId");


--
-- Name: SmsMessage_threadId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "SmsMessage_threadId_idx" ON public."SmsMessage" USING btree ("threadId");


--
-- Name: SmsOptOut_phone_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "SmsOptOut_phone_idx" ON public."SmsOptOut" USING btree (phone);


--
-- Name: SmsOptOut_phone_provider_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "SmsOptOut_phone_provider_key" ON public."SmsOptOut" USING btree (phone, provider);


--
-- Name: SmsParticipant_phone_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "SmsParticipant_phone_idx" ON public."SmsParticipant" USING btree (phone);


--
-- Name: SmsParticipant_threadId_phone_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "SmsParticipant_threadId_phone_key" ON public."SmsParticipant" USING btree ("threadId", phone);


--
-- Name: SmsThread_userId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "SmsThread_userId_idx" ON public."SmsThread" USING btree ("userId");


--
-- Name: StatusAsset_statusId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "StatusAsset_statusId_idx" ON public."StatusAsset" USING btree ("statusId");


--
-- Name: StatusView_statusId_viewerId_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "StatusView_statusId_viewerId_key" ON public."StatusView" USING btree ("statusId", "viewerId");


--
-- Name: StatusView_viewerId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "StatusView_viewerId_idx" ON public."StatusView" USING btree ("viewerId");


--
-- Name: Status_authorId_expiresAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Status_authorId_expiresAt_idx" ON public."Status" USING btree ("authorId", "expiresAt");


--
-- Name: Subscriber_iccid_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "Subscriber_iccid_key" ON public."Subscriber" USING btree (iccid);


--
-- Name: Subscriber_msisdn_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Subscriber_msisdn_idx" ON public."Subscriber" USING btree (msisdn);


--
-- Name: Subscriber_provider_providerProfileId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Subscriber_provider_providerProfileId_idx" ON public."Subscriber" USING btree (provider, "providerProfileId");


--
-- Name: Subscriber_userId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Subscriber_userId_idx" ON public."Subscriber" USING btree ("userId");


--
-- Name: ThreadState_userId_chatRoomId_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "ThreadState_userId_chatRoomId_key" ON public."ThreadState" USING btree ("userId", "chatRoomId");


--
-- Name: Transcript_callId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Transcript_callId_idx" ON public."Transcript" USING btree ("callId");


--
-- Name: Transcript_messageId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Transcript_messageId_idx" ON public."Transcript" USING btree ("messageId");


--
-- Name: Transcript_userId_createdAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Transcript_userId_createdAt_idx" ON public."Transcript" USING btree ("userId", "createdAt");


--
-- Name: Translation_language_key_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "Translation_language_key_key" ON public."Translation" USING btree (language, key);


--
-- Name: TwoFactorRecoveryCode_userId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "TwoFactorRecoveryCode_userId_idx" ON public."TwoFactorRecoveryCode" USING btree ("userId");


--
-- Name: Upload_ownerId_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Upload_ownerId_idx" ON public."Upload" USING btree ("ownerId");


--
-- Name: Upload_sha256_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "Upload_sha256_idx" ON public."Upload" USING btree (sha256);


--
-- Name: User_billingSubscriptionId_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "User_billingSubscriptionId_key" ON public."User" USING btree ("billingSubscriptionId");


--
-- Name: User_email_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "User_email_key" ON public."User" USING btree (email);


--
-- Name: User_username_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "User_username_key" ON public."User" USING btree (username);


--
-- Name: VerificationToken_expiresAt_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "VerificationToken_expiresAt_idx" ON public."VerificationToken" USING btree ("expiresAt");


--
-- Name: VerificationToken_userId_type_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "VerificationToken_userId_type_idx" ON public."VerificationToken" USING btree ("userId", type);


--
-- Name: VoiceLog_callSid_key; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX "VoiceLog_callSid_key" ON public."VoiceLog" USING btree ("callSid");


--
-- Name: _RandomChatParticipants_B_index; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "_RandomChatParticipants_B_index" ON public."_RandomChatParticipants" USING btree ("B");


--
-- Name: _ReadMessages_B_index; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX "_ReadMessages_B_index" ON public."_ReadMessages" USING btree ("B");


--
-- Name: msg_client_idempotency; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE UNIQUE INDEX msg_client_idempotency ON public."Message" USING btree ("chatRoomId", "senderId", "clientMessageId");


--
-- Name: msg_deleted_expires_idx; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX msg_deleted_expires_idx ON public."Message" USING btree ("deletedForAll", "expiresAt");


--
-- Name: msg_room_id; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX msg_room_id ON public."Message" USING btree ("chatRoomId", id);


--
-- Name: msg_room_time; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX msg_room_time ON public."Message" USING btree ("chatRoomId", "createdAt");


--
-- Name: msg_room_time_id; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX msg_room_time_id ON public."Message" USING btree ("chatRoomId", "createdAt", id);


--
-- Name: part_room; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX part_room ON public."Participant" USING btree ("chatRoomId");


--
-- Name: part_user_cleared; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX part_user_cleared ON public."Participant" USING btree ("userId", "clearedAt");


--
-- Name: room_updated_id; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX room_updated_id ON public."ChatRoom" USING btree ("updatedAt", id);


--
-- Name: status_emoji; Type: INDEX; Schema: public; Owner: doadmin
--

CREATE INDEX status_emoji ON public."StatusReaction" USING btree ("statusId", emoji);


--
-- Name: AuditLog AuditLog_actorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."AuditLog"
    ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BotEventLog BotEventLog_installId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."BotEventLog"
    ADD CONSTRAINT "BotEventLog_installId_fkey" FOREIGN KEY ("installId") REFERENCES public."BotInstall"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BotInstall BotInstall_botId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."BotInstall"
    ADD CONSTRAINT "BotInstall_botId_fkey" FOREIGN KEY ("botId") REFERENCES public."Bot"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: BotInstall BotInstall_chatRoomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."BotInstall"
    ADD CONSTRAINT "BotInstall_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES public."ChatRoom"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Bot Bot_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Bot"
    ADD CONSTRAINT "Bot_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Bot Bot_serviceUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Bot"
    ADD CONSTRAINT "Bot_serviceUserId_fkey" FOREIGN KEY ("serviceUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Call Call_calleeId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Call"
    ADD CONSTRAINT "Call_calleeId_fkey" FOREIGN KEY ("calleeId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Call Call_callerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Call"
    ADD CONSTRAINT "Call_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ChatRoomInvite ChatRoomInvite_chatRoomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ChatRoomInvite"
    ADD CONSTRAINT "ChatRoomInvite_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES public."ChatRoom"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ChatRoomInvite ChatRoomInvite_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ChatRoomInvite"
    ADD CONSTRAINT "ChatRoomInvite_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ChatRoom ChatRoom_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ChatRoom"
    ADD CONSTRAINT "ChatRoom_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Contact Contact_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Contact"
    ADD CONSTRAINT "Contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Contact Contact_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Contact"
    ADD CONSTRAINT "Contact_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Device Device_revokedById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Device"
    ADD CONSTRAINT "Device_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Device Device_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Device"
    ADD CONSTRAINT "Device_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: FamilyGroup FamilyGroup_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."FamilyGroup"
    ADD CONSTRAINT "FamilyGroup_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FamilyInvite FamilyInvite_groupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."FamilyInvite"
    ADD CONSTRAINT "FamilyInvite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES public."FamilyGroup"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FamilyMember FamilyMember_groupId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."FamilyMember"
    ADD CONSTRAINT "FamilyMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES public."FamilyGroup"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: FamilyMember FamilyMember_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."FamilyMember"
    ADD CONSTRAINT "FamilyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Follow Follow_followerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Follow"
    ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Follow Follow_followingId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Follow"
    ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ForiaMessage ForiaMessage_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ForiaMessage"
    ADD CONSTRAINT "ForiaMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: MessageAttachment MessageAttachment_messageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageAttachment"
    ADD CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public."Message"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MessageDeletion MessageDeletion_messageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageDeletion"
    ADD CONSTRAINT "MessageDeletion_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public."Message"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MessageDeletion MessageDeletion_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageDeletion"
    ADD CONSTRAINT "MessageDeletion_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MessageKey MessageKey_messageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageKey"
    ADD CONSTRAINT "MessageKey_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public."Message"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MessageKey MessageKey_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageKey"
    ADD CONSTRAINT "MessageKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MessageReaction MessageReaction_messageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageReaction"
    ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public."Message"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MessageReaction MessageReaction_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageReaction"
    ADD CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MessageRead MessageRead_messageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageRead"
    ADD CONSTRAINT "MessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public."Message"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MessageRead MessageRead_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageRead"
    ADD CONSTRAINT "MessageRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MessageSessionKey MessageSessionKey_messageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageSessionKey"
    ADD CONSTRAINT "MessageSessionKey_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public."Message"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MessageSessionKey MessageSessionKey_recipientDeviceId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageSessionKey"
    ADD CONSTRAINT "MessageSessionKey_recipientDeviceId_fkey" FOREIGN KEY ("recipientDeviceId") REFERENCES public."Device"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MessageSessionKey MessageSessionKey_recipientUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MessageSessionKey"
    ADD CONSTRAINT "MessageSessionKey_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Message Message_chatRoomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Message"
    ADD CONSTRAINT "Message_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES public."ChatRoom"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Message Message_randomChatRoomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Message"
    ADD CONSTRAINT "Message_randomChatRoomId_fkey" FOREIGN KEY ("randomChatRoomId") REFERENCES public."RandomChatRoom"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Message Message_senderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Message"
    ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: MobileDataPackPurchase MobileDataPackPurchase_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."MobileDataPackPurchase"
    ADD CONSTRAINT "MobileDataPackPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: NumberReservation NumberReservation_phoneNumberId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."NumberReservation"
    ADD CONSTRAINT "NumberReservation_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES public."PhoneNumber"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: NumberReservation NumberReservation_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."NumberReservation"
    ADD CONSTRAINT "NumberReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: Participant Participant_chatRoomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Participant"
    ADD CONSTRAINT "Participant_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES public."ChatRoom"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Participant Participant_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Participant"
    ADD CONSTRAINT "Participant_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PasswordResetToken PasswordResetToken_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PeopleInvite PeopleInvite_acceptedByUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PeopleInvite"
    ADD CONSTRAINT "PeopleInvite_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PeopleInvite PeopleInvite_inviterUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PeopleInvite"
    ADD CONSTRAINT "PeopleInvite_inviterUserId_fkey" FOREIGN KEY ("inviterUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: PhoneNumber PhoneNumber_assignedUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PhoneNumber"
    ADD CONSTRAINT "PhoneNumber_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PhoneVerificationRequest PhoneVerificationRequest_phoneId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PhoneVerificationRequest"
    ADD CONSTRAINT "PhoneVerificationRequest_phoneId_fkey" FOREIGN KEY ("phoneId") REFERENCES public."Phone"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Phone Phone_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Phone"
    ADD CONSTRAINT "Phone_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: PortRequest PortRequest_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."PortRequest"
    ADD CONSTRAINT "PortRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: ProvisionLink ProvisionLink_createdById_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ProvisionLink"
    ADD CONSTRAINT "ProvisionLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: ProvisionLink ProvisionLink_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ProvisionLink"
    ADD CONSTRAINT "ProvisionLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Report Report_messageId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Report"
    ADD CONSTRAINT "Report_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES public."Message"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Report Report_reportedUserId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Report"
    ADD CONSTRAINT "Report_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Report Report_reporterId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Report"
    ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: STTUsage STTUsage_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."STTUsage"
    ADD CONSTRAINT "STTUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ScheduledMessage ScheduledMessage_chatRoomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ScheduledMessage"
    ADD CONSTRAINT "ScheduledMessage_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES public."ChatRoom"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ScheduledMessage ScheduledMessage_senderId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ScheduledMessage"
    ADD CONSTRAINT "ScheduledMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SmsMessage SmsMessage_phoneId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsMessage"
    ADD CONSTRAINT "SmsMessage_phoneId_fkey" FOREIGN KEY ("phoneId") REFERENCES public."Phone"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SmsMessage SmsMessage_threadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsMessage"
    ADD CONSTRAINT "SmsMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES public."SmsThread"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: SmsParticipant SmsParticipant_threadId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsParticipant"
    ADD CONSTRAINT "SmsParticipant_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES public."SmsThread"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: SmsThread SmsThread_contactId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsThread"
    ADD CONSTRAINT "SmsThread_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES public."Contact"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: SmsThread SmsThread_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."SmsThread"
    ADD CONSTRAINT "SmsThread_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StatusAsset StatusAsset_statusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."StatusAsset"
    ADD CONSTRAINT "StatusAsset_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES public."Status"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StatusKey StatusKey_statusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."StatusKey"
    ADD CONSTRAINT "StatusKey_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES public."Status"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StatusKey StatusKey_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."StatusKey"
    ADD CONSTRAINT "StatusKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StatusReaction StatusReaction_statusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."StatusReaction"
    ADD CONSTRAINT "StatusReaction_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES public."Status"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StatusReaction StatusReaction_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."StatusReaction"
    ADD CONSTRAINT "StatusReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StatusView StatusView_statusId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."StatusView"
    ADD CONSTRAINT "StatusView_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES public."Status"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: StatusView StatusView_viewerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."StatusView"
    ADD CONSTRAINT "StatusView_viewerId_fkey" FOREIGN KEY ("viewerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Status Status_authorId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Status"
    ADD CONSTRAINT "Status_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ThreadState ThreadState_chatRoomId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ThreadState"
    ADD CONSTRAINT "ThreadState_chatRoomId_fkey" FOREIGN KEY ("chatRoomId") REFERENCES public."ChatRoom"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: ThreadState ThreadState_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."ThreadState"
    ADD CONSTRAINT "ThreadState_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Transcript Transcript_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Transcript"
    ADD CONSTRAINT "Transcript_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: TwoFactorRecoveryCode TwoFactorRecoveryCode_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."TwoFactorRecoveryCode"
    ADD CONSTRAINT "TwoFactorRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Upload Upload_ownerId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Upload"
    ADD CONSTRAINT "Upload_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: VerificationToken VerificationToken_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."VerificationToken"
    ADD CONSTRAINT "VerificationToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: Voicemail Voicemail_phoneNumberId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Voicemail"
    ADD CONSTRAINT "Voicemail_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES public."PhoneNumber"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Voicemail Voicemail_relatedCallId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Voicemail"
    ADD CONSTRAINT "Voicemail_relatedCallId_fkey" FOREIGN KEY ("relatedCallId") REFERENCES public."Call"(id) ON UPDATE CASCADE ON DELETE SET NULL;


--
-- Name: Voicemail Voicemail_userId_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."Voicemail"
    ADD CONSTRAINT "Voicemail_userId_fkey" FOREIGN KEY ("userId") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;


--
-- Name: _RandomChatParticipants _RandomChatParticipants_A_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."_RandomChatParticipants"
    ADD CONSTRAINT "_RandomChatParticipants_A_fkey" FOREIGN KEY ("A") REFERENCES public."RandomChatRoom"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: _RandomChatParticipants _RandomChatParticipants_B_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."_RandomChatParticipants"
    ADD CONSTRAINT "_RandomChatParticipants_B_fkey" FOREIGN KEY ("B") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: _ReadMessages _ReadMessages_A_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."_ReadMessages"
    ADD CONSTRAINT "_ReadMessages_A_fkey" FOREIGN KEY ("A") REFERENCES public."Message"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- Name: _ReadMessages _ReadMessages_B_fkey; Type: FK CONSTRAINT; Schema: public; Owner: doadmin
--

ALTER TABLE ONLY public."_ReadMessages"
    ADD CONSTRAINT "_ReadMessages_B_fkey" FOREIGN KEY ("B") REFERENCES public."User"(id) ON UPDATE CASCADE ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict PqY61XefKv7FTj5hip0VqV5z5yNvugODPAaljhdBL6SzeZDKgj4ri5UP3hYIegy

