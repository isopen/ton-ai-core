export interface TelegramBotConfig {
    token: string;
    apiBaseUrl?: string;
    pollingTimeout?: number;
    pollingLimit?: number;
    allowedUpdates?: string[];
    webhookUrl?: string;
    webhookMaxConnections?: number;
    webhookSecretToken?: string;
    dropPendingUpdates?: boolean;
    botInfoCacheTTL?: number;
    messageCacheSize?: number;
    fileCacheSize?: number;
    rateLimitDefault?: number;
    rateLimitWindow?: number;
    retryOnError?: boolean;
    maxRetries?: number;
}

export interface Update {
    update_id: number;
    message?: Message;
    edited_message?: Message;
    channel_post?: Message;
    edited_channel_post?: Message;
    inline_query?: InlineQuery;
    chosen_inline_result?: ChosenInlineResult;
    callback_query?: CallbackQuery;
    shipping_query?: ShippingQuery;
    pre_checkout_query?: PreCheckoutQuery;
    poll?: Poll;
    poll_answer?: PollAnswer;
    my_chat_member?: ChatMemberUpdated;
    chat_member?: ChatMemberUpdated;
    chat_join_request?: ChatJoinRequest;
    business_connection?: BusinessConnection;
    business_message?: Message;
    edited_business_message?: Message;
    deleted_business_messages?: any;
    message_reaction?: any;
    message_reaction_count?: any;
    chat_boost?: ChatBoost;
    removed_chat_boost?: any;
}

export interface MessageEntity {
    type: 'mention' | 'hashtag' | 'cashtag' | 'bot_command' | 'url' | 'email' | 'phone_number' | 'bold' | 'italic' | 'underline' | 'strikethrough' | 'spoiler' | 'blockquote' | 'expandable_blockquote' | 'code' | 'pre' | 'text_link' | 'text_mention' | 'custom_emoji' | 'date_time';
    offset: number;
    length: number;
    url?: string;
    user?: User;
    language?: string;
    custom_emoji_id?: string;
}

export interface Message {
    message_id: number;
    message_thread_id?: number;
    from?: User;
    sender_chat?: Chat;
    date: number;
    chat: Chat;
    forward_origin?: any;
    is_topic_message?: boolean;
    reply_to_message?: Message;
    external_reply?: any;
    quote?: any;
    reply_to_story?: any;
    via_bot?: User;
    edit_date?: number;
    has_protected_content?: boolean;
    is_from_offline?: boolean;
    media_group_id?: string;
    author_signature?: string;
    text?: string;
    entities?: MessageEntity[];
    link_preview_options?: any;
    effect_id?: string;
    animation?: Animation;
    audio?: Audio;
    document?: Document;
    photo?: PhotoSize[];
    sticker?: Sticker;
    story?: any;
    video?: Video;
    video_note?: VideoNote;
    voice?: Voice;
    caption?: string;
    caption_entities?: MessageEntity[];
    has_media_spoiler?: boolean;
    contact?: Contact;
    dice?: Dice;
    game?: Game;
    poll?: Poll;
    venue?: Venue;
    location?: Location;
    new_chat_members?: User[];
    left_chat_member?: User;
    new_chat_title?: string;
    new_chat_photo?: PhotoSize[];
    delete_chat_photo?: boolean;
    group_chat_created?: boolean;
    supergroup_chat_created?: boolean;
    channel_chat_created?: boolean;
    message_auto_delete_timer_changed?: any;
    migrate_to_chat_id?: number;
    migrate_from_chat_id?: number;
    pinned_message?: Message;
    invoice?: Invoice;
    successful_payment?: SuccessfulPayment;
    users_shared?: any;
    chat_shared?: any;
    connected_website?: string;
    write_access_allowed?: any;
    passport_data?: any;
    proximity_alert_triggered?: any;
    boost_added?: any;
    forum_topic_created?: ForumTopicCreated;
    forum_topic_edited?: ForumTopicEdited;
    forum_topic_closed?: ForumTopicClosed;
    forum_topic_reopened?: ForumTopicReopened;
    general_forum_topic_hidden?: GeneralForumTopicHidden;
    general_forum_topic_unhidden?: GeneralForumTopicUnhidden;
    giveaway_created?: any;
    giveaway?: any;
    giveaway_winners?: any;
    giveaway_completed?: any;
    video_chat_scheduled?: any;
    video_chat_started?: any;
    video_chat_ended?: any;
    video_chat_participants_invited?: any;
    web_app_data?: any;
    reply_markup?: any;
    sender_tag?: string;
}

export interface User {
    id: number;
    is_bot: boolean;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
    is_premium?: boolean;
    added_to_attachment_menu?: boolean;
    can_join_groups?: boolean;
    can_read_all_group_messages?: boolean;
    supports_inline_queries?: boolean;
    can_connect_to_business?: boolean;
    has_main_web_app?: boolean;
}

export interface Chat {
    id: number;
    type: 'private' | 'group' | 'supergroup' | 'channel';
    title?: string;
    username?: string;
    first_name?: string;
    last_name?: string;
    is_forum?: boolean;
    photo?: ChatPhoto;
    active_usernames?: string[];
    birthdate?: any;
    business_intro?: any;
    business_location?: any;
    business_opening_hours?: any;
    personal_chat?: Chat;
    available_reactions?: any[];
    accent_color_id?: number;
    background_custom_emoji_id?: string;
    profile_accent_color_id?: number;
    profile_background_custom_emoji_id?: string;
    emoji_status_custom_emoji_id?: string;
    emoji_status_expiration_date?: number;
    bio?: string;
    has_private_forwards?: boolean;
    has_restricted_voice_and_video_messages?: boolean;
    join_to_send_messages?: boolean;
    join_by_request?: boolean;
    description?: string;
    invite_link?: string;
    pinned_message?: Message;
    permissions?: ChatPermissions;
    can_send_gift?: boolean;
    can_send_paid_media?: boolean;
    slow_mode_delay?: number;
    message_auto_delete_time?: number;
    has_protected_content?: boolean;
    sticker_set_name?: string;
    can_set_sticker_set?: boolean;
    linked_chat_id?: number;
    location?: ChatLocation;
}

export interface ChatPhoto {
    small_file_id: string;
    small_file_unique_id: string;
    big_file_id: string;
    big_file_unique_id: string;
}

export interface ChatLocation {
    location: Location;
    address: string;
}

export interface File {
    file_id: string;
    file_unique_id: string;
    file_size?: number;
    file_path?: string;
}

export interface InputFile {
    source: Buffer | Uint8Array | string | Blob;
    filename?: string;
}

export interface MessageId {
    message_id: number;
}

export interface PhotoSize {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    file_size?: number;
}

export interface Animation {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    duration: number;
    thumbnail?: PhotoSize;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
}

export interface Audio {
    file_id: string;
    file_unique_id: string;
    duration: number;
    performer?: string;
    title?: string;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
    thumbnail?: PhotoSize;
}

export interface Document {
    file_id: string;
    file_unique_id: string;
    thumbnail?: PhotoSize;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
}

export interface Video {
    file_id: string;
    file_unique_id: string;
    width: number;
    height: number;
    duration: number;
    thumbnail?: PhotoSize;
    file_name?: string;
    mime_type?: string;
    file_size?: number;
}

export interface VideoNote {
    file_id: string;
    file_unique_id: string;
    length: number;
    duration: number;
    thumbnail?: PhotoSize;
    file_size?: number;
}

export interface Voice {
    file_id: string;
    file_unique_id: string;
    duration: number;
    mime_type?: string;
    file_size?: number;
}

export interface Sticker {
    file_id: string;
    file_unique_id: string;
    type: 'regular' | 'mask' | 'custom_emoji';
    width: number;
    height: number;
    is_animated: boolean;
    is_video: boolean;
    thumbnail?: PhotoSize;
    emoji?: string;
    set_name?: string;
    premium_animation?: File;
    mask_position?: any;
    custom_emoji_id?: string;
    needs_repainting?: boolean;
    file_size?: number;
}

export interface StickerSet {
    name: string;
    title: string;
    sticker_type: 'regular' | 'mask' | 'custom_emoji';
    stickers: Sticker[];
    thumbnail?: PhotoSize;
}

export interface Contact {
    phone_number: string;
    first_name: string;
    last_name?: string;
    user_id?: number;
    vcard?: string;
}

export interface Dice {
    emoji: string;
    value: number;
}

export interface Game {
    title: string;
    description: string;
    photo: PhotoSize[];
    text?: string;
    text_entities?: MessageEntity[];
    animation?: Animation;
}

export interface Poll {
    id: string;
    question: string;
    options: PollOption[];
    total_voter_count: number;
    is_closed: boolean;
    is_anonymous: boolean;
    type: 'regular' | 'quiz';
    allows_multiple_answers: boolean;
    correct_option_id?: number;
    explanation?: string;
    explanation_entities?: MessageEntity[];
    open_period?: number;
    close_date?: number;
}

export interface PollOption {
    text: string;
    voter_count: number;
}

export interface PollAnswer {
    poll_id: string;
    user: User;
    option_ids: number[];
}

export interface Location {
    longitude: number;
    latitude: number;
    horizontal_accuracy?: number;
    live_period?: number;
    heading?: number;
    proximity_alert_radius?: number;
}

export interface Venue {
    location: Location;
    title: string;
    address: string;
    foursquare_id?: string;
    foursquare_type?: string;
    google_place_id?: string;
    google_place_type?: string;
}

export interface Invoice {
    title: string;
    description: string;
    start_parameter: string;
    currency: string;
    total_amount: number;
}

export interface SuccessfulPayment {
    currency: string;
    total_amount: number;
    invoice_payload: string;
    shipping_option_id?: string;
    order_info?: any;
    telegram_payment_charge_id: string;
    provider_payment_charge_id: string;
}

export interface BotCommand {
    command: string;
    description: string;
}

export interface BotCommandScope {
    type: string;
    chat_id?: number;
    user_id?: number;
}

export interface BotName {
    name: string;
}

export interface BotDescription {
    description: string;
}

export interface BotShortDescription {
    short_description: string;
}

export interface WebhookInfo {
    url: string;
    has_custom_certificate: boolean;
    pending_update_count: number;
    ip_address?: string;
    last_error_date?: number;
    last_error_message?: string;
    last_synchronization_error_date?: number;
    max_connections?: number;
    allowed_updates?: string[];
}

export interface MenuButton {
    type: 'commands' | 'web_app' | 'default';
    text?: string;
    web_app?: any;
}

export interface ChatPermissions {
    can_send_messages?: boolean;
    can_send_audios?: boolean;
    can_send_documents?: boolean;
    can_send_photos?: boolean;
    can_send_videos?: boolean;
    can_send_video_notes?: boolean;
    can_send_voice_notes?: boolean;
    can_send_polls?: boolean;
    can_send_other_messages?: boolean;
    can_add_web_page_previews?: boolean;
    can_change_info?: boolean;
    can_invite_users?: boolean;
    can_pin_messages?: boolean;
    can_manage_topics?: boolean;
    can_edit_tag?: boolean;
}

export interface ChatMember {
    status: string;
    user: User;
    until_date?: number;
    can_be_edited?: boolean;
    can_manage_chat?: boolean;
    can_change_info?: boolean;
    can_post_messages?: boolean;
    can_edit_messages?: boolean;
    can_delete_messages?: boolean;
    can_invite_users?: boolean;
    can_restrict_members?: boolean;
    can_pin_messages?: boolean;
    can_manage_topics?: boolean;
    can_promote_members?: boolean;
    can_manage_video_chats?: boolean;
    can_post_stories?: boolean;
    can_edit_stories?: boolean;
    can_delete_stories?: boolean;
    is_anonymous?: boolean;
    custom_title?: string;
    tag?: string;
    can_edit_tag?: boolean;
    can_manage_tags?: boolean;
}

export interface ChatMemberUpdated {
    chat: Chat;
    from: User;
    date: number;
    old_chat_member: ChatMember;
    new_chat_member: ChatMember;
    invite_link?: ChatInviteLink;
    via_join_request?: boolean;
    via_chat_folder_invite_link?: boolean;
}

export interface ChatJoinRequest {
    chat: Chat;
    from: User;
    user_chat_id?: number;
    date: number;
    bio?: string;
    invite_link?: ChatInviteLink;
}

export interface ChatAdministratorRights {
    is_anonymous: boolean;
    can_manage_chat: boolean;
    can_delete_messages: boolean;
    can_manage_video_chats: boolean;
    can_restrict_members: boolean;
    can_promote_members: boolean;
    can_change_info: boolean;
    can_invite_users: boolean;
    can_post_stories?: boolean;
    can_edit_stories?: boolean;
    can_delete_stories?: boolean;
    can_post_messages?: boolean;
    can_edit_messages?: boolean;
    can_pin_messages?: boolean;
    can_manage_topics?: boolean;
    can_manage_tags?: boolean;
}

export interface ChatInviteLink {
    invite_link: string;
    creator: User;
    creates_join_request: boolean;
    is_primary: boolean;
    is_revoked: boolean;
    name?: string;
    expire_date?: number;
    member_limit?: number;
    pending_join_request_count?: number;
}

export interface ForumTopic {
    message_thread_id: number;
    name: string;
    icon_color: number;
    icon_custom_emoji_id?: string;
}

export interface ForumTopicCreated {
    name: string;
    icon_color: number;
    icon_custom_emoji_id?: string;
}

export interface ForumTopicEdited {
    name?: string;
    icon_custom_emoji_id?: string;
}

export interface ForumTopicClosed {
    [key: string]: never;
}

export interface ForumTopicReopened {
    [key: string]: never;
}

export interface GeneralForumTopicHidden {
    [key: string]: never;
}

export interface GeneralForumTopicUnhidden {
    [key: string]: never;
}

export interface BusinessConnection {
    id: string;
    user: User;
    user_chat_id: number;
    date: number;
    can_reply: boolean;
    is_enabled: boolean;
}

export interface InlineQuery {
    id: string;
    from: User;
    query: string;
    offset: string;
    chat_type?: string;
    location?: Location;
}

export interface ChosenInlineResult {
    result_id: string;
    from: User;
    location?: Location;
    inline_message_id?: string;
    query: string;
}

export interface CallbackQuery {
    id: string;
    from: User;
    message?: Message;
    inline_message_id?: string;
    chat_instance: string;
    data?: string;
    game_short_name?: string;
}

export interface ShippingQuery {
    id: string;
    from: User;
    invoice_payload: string;
    shipping_address: any;
}

export interface PreCheckoutQuery {
    id: string;
    from: User;
    currency: string;
    total_amount: number;
    invoice_payload: string;
    shipping_option_id?: string;
    order_info?: any;
}

export interface LabeledPrice {
    label: string;
    amount: number;
}

export interface ShippingOption {
    id: string;
    title: string;
    prices: LabeledPrice[];
}

export interface InlineQueryResult {
    type: string;
    id: string;
    [key: string]: any;
}

export interface ChatBoost {
    boost_id: string;
    add_date: number;
    expiration_date: number;
    source: any;
}

export interface UserChatBoosts {
    boosts: ChatBoost[];
}

export interface ResponseParameters {
    migrate_to_chat_id?: number;
    retry_after?: number;
}

export interface InputMedia {
    type: string;
    media: string;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
}

export interface InputMediaPhoto extends InputMedia {
    type: 'photo';
    has_spoiler?: boolean;
}

export interface InputMediaVideo extends InputMedia {
    type: 'video';
    thumbnail?: InputFile | string;
    width?: number;
    height?: number;
    duration?: number;
    supports_streaming?: boolean;
    has_spoiler?: boolean;
}

export interface InputMediaAnimation extends InputMedia {
    type: 'animation';
    thumbnail?: InputFile | string;
    width?: number;
    height?: number;
    duration?: number;
    has_spoiler?: boolean;
}

export interface InputMediaAudio extends InputMedia {
    type: 'audio';
    thumbnail?: InputFile | string;
    duration?: number;
    performer?: string;
    title?: string;
}

export interface InputMediaDocument extends InputMedia {
    type: 'document';
    thumbnail?: InputFile | string;
    disable_content_type_detection?: boolean;
}

export interface InlineKeyboardMarkup {
    inline_keyboard: InlineKeyboardButton[][];
}

export interface InlineKeyboardButton {
    text: string;
    url?: string;
    callback_data?: string;
    web_app?: any;
    login_url?: any;
    switch_inline_query?: string;
    switch_inline_query_current_chat?: string;
    callback_game?: any;
    pay?: boolean;
    icon_custom_emoji_id?: string;
}

export interface ReplyKeyboardMarkup {
    keyboard: KeyboardButton[][];
    is_persistent?: boolean;
    resize_keyboard?: boolean;
    one_time_keyboard?: boolean;
    input_field_placeholder?: string;
    selective?: boolean;
}

export interface KeyboardButton {
    text: string;
    request_users?: any;
    request_chat?: any;
    request_contact?: boolean;
    request_location?: boolean;
    request_poll?: any;
    web_app?: any;
    icon_custom_emoji_id?: string;
}

export interface ReplyKeyboardRemove {
    remove_keyboard: true;
    selective?: boolean;
}

export interface ForceReply {
    force_reply: true;
    input_field_placeholder?: string;
    selective?: boolean;
}

export interface SendMessageParams {
    chat_id: number;
    text: string;
    message_thread_id?: number;
    parse_mode?: string;
    entities?: MessageEntity[];
    link_preview_options?: any;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SendMessageDraftParams {
    chat_id: number;
    draft_id: number;
    text: string;
    message_thread_id?: number;
    parse_mode?: string;
    entities?: MessageEntity[];
    disable_notification?: boolean;
    protect_content?: boolean;
    reply_parameters?: any;
    business_connection_id?: string;
}

export interface SendPhotoParams {
    chat_id: number;
    photo: InputFile | string;
    message_thread_id?: number;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    has_spoiler?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SendAudioParams {
    chat_id: number;
    audio: InputFile | string;
    message_thread_id?: number;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    duration?: number;
    performer?: string;
    title?: string;
    thumbnail?: InputFile | string;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SendDocumentParams {
    chat_id: number;
    document: InputFile | string;
    message_thread_id?: number;
    thumbnail?: InputFile | string;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    disable_content_type_detection?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SendVideoParams {
    chat_id: number;
    video: InputFile | string;
    message_thread_id?: number;
    duration?: number;
    width?: number;
    height?: number;
    thumbnail?: InputFile | string;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    has_spoiler?: boolean;
    supports_streaming?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SendAnimationParams {
    chat_id: number;
    animation: InputFile | string;
    message_thread_id?: number;
    duration?: number;
    width?: number;
    height?: number;
    thumbnail?: InputFile | string;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    has_spoiler?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SendVoiceParams {
    chat_id: number;
    voice: InputFile | string;
    message_thread_id?: number;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    duration?: number;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SendVideoNoteParams {
    chat_id: number;
    video_note: InputFile | string;
    message_thread_id?: number;
    duration?: number;
    length?: number;
    thumbnail?: InputFile | string;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SendMediaGroupParams {
    chat_id: number;
    media: (InputMediaPhoto | InputMediaVideo | InputMediaAnimation | InputMediaAudio | InputMediaDocument)[];
    message_thread_id?: number;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    business_connection_id?: string;
}

export interface SendLocationParams {
    chat_id: number;
    latitude: number;
    longitude: number;
    message_thread_id?: number;
    horizontal_accuracy?: number;
    live_period?: number;
    heading?: number;
    proximity_alert_radius?: number;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SendVenueParams {
    chat_id: number;
    latitude: number;
    longitude: number;
    title: string;
    address: string;
    message_thread_id?: number;
    foursquare_id?: string;
    foursquare_type?: string;
    google_place_id?: string;
    google_place_type?: string;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SendContactParams {
    chat_id: number;
    phone_number: string;
    first_name: string;
    message_thread_id?: number;
    last_name?: string;
    vcard?: string;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SendPollParams {
    chat_id: number;
    question: string;
    options: string[];
    message_thread_id?: number;
    question_parse_mode?: string;
    question_entities?: MessageEntity[];
    is_anonymous?: boolean;
    type?: 'regular' | 'quiz';
    allows_multiple_answers?: boolean;
    correct_option_id?: number;
    explanation?: string;
    explanation_parse_mode?: string;
    explanation_entities?: MessageEntity[];
    open_period?: number;
    close_date?: number;
    is_closed?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SendDiceParams {
    chat_id: number;
    message_thread_id?: number;
    emoji?: string;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface SendChatActionParams {
    chat_id: number;
    action: string;
    message_thread_id?: number;
    business_connection_id?: string;
}

export interface SendStickerParams {
    chat_id: number;
    sticker: InputFile | string;
    message_thread_id?: number;
    emoji?: string;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    business_connection_id?: string;
}

export interface ForwardMessageParams {
    chat_id: number;
    from_chat_id: number;
    message_id: number;
    message_thread_id?: number;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
}

export interface CopyMessageParams {
    chat_id: number;
    from_chat_id: number;
    message_id: number;
    message_thread_id?: number;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup | ReplyKeyboardMarkup | ReplyKeyboardRemove | ForceReply;
    message_effect_id?: string;
}

export interface EditMessageTextParams {
    chat_id?: number;
    message_id?: number;
    inline_message_id?: string;
    text: string;
    parse_mode?: string;
    entities?: MessageEntity[];
    link_preview_options?: any;
    reply_markup?: InlineKeyboardMarkup;
}

export interface EditMessageCaptionParams {
    chat_id?: number;
    message_id?: number;
    inline_message_id?: string;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    reply_markup?: InlineKeyboardMarkup;
}

export interface EditMessageMediaParams {
    chat_id?: number;
    message_id?: number;
    inline_message_id?: string;
    media: InputMediaPhoto | InputMediaVideo | InputMediaAnimation | InputMediaAudio | InputMediaDocument;
    reply_markup?: InlineKeyboardMarkup;
}

export interface EditMessageReplyMarkupParams {
    chat_id?: number;
    message_id?: number;
    inline_message_id?: string;
    reply_markup?: InlineKeyboardMarkup;
}

export interface StopPollParams {
    chat_id: number;
    message_id: number;
    reply_markup?: InlineKeyboardMarkup;
    business_connection_id?: string;
}

export interface DeleteMessageParams {
    chat_id: number;
    message_id: number;
}

export interface BanChatMemberParams {
    chat_id: number;
    user_id: number;
    until_date?: number;
    revoke_messages?: boolean;
}

export interface UnbanChatMemberParams {
    chat_id: number;
    user_id: number;
    only_if_banned?: boolean;
}

export interface RestrictChatMemberParams {
    chat_id: number;
    user_id: number;
    permissions: ChatPermissions;
    use_independent_chat_permissions?: boolean;
    until_date?: number;
}

export interface PromoteChatMemberParams {
    chat_id: number;
    user_id: number;
    is_anonymous?: boolean;
    can_manage_chat?: boolean;
    can_delete_messages?: boolean;
    can_manage_video_chats?: boolean;
    can_restrict_members?: boolean;
    can_promote_members?: boolean;
    can_change_info?: boolean;
    can_invite_users?: boolean;
    can_post_stories?: boolean;
    can_edit_stories?: boolean;
    can_delete_stories?: boolean;
    can_post_messages?: boolean;
    can_edit_messages?: boolean;
    can_pin_messages?: boolean;
    can_manage_topics?: boolean;
    can_manage_tags?: boolean;
}

export interface SetChatAdministratorCustomTitleParams {
    chat_id: number;
    user_id: number;
    custom_title: string;
}

export interface SetChatMemberTagParams {
    chat_id: number;
    user_id: number;
    tag?: string;
}

export interface BanChatSenderChatParams {
    chat_id: number;
    sender_chat_id: number;
}

export interface UnbanChatSenderChatParams {
    chat_id: number;
    sender_chat_id: number;
}

export interface SetChatPermissionsParams {
    chat_id: number;
    permissions: ChatPermissions;
    use_independent_chat_permissions?: boolean;
}

export interface ExportChatInviteLinkParams {
    chat_id: number;
}

export interface CreateChatInviteLinkParams {
    chat_id: number;
    name?: string;
    expire_date?: number;
    member_limit?: number;
    creates_join_request?: boolean;
}

export interface EditChatInviteLinkParams {
    chat_id: number;
    invite_link: string;
    name?: string;
    expire_date?: number;
    member_limit?: number;
    creates_join_request?: boolean;
}

export interface RevokeChatInviteLinkParams {
    chat_id: number;
    invite_link: string;
}

export interface ApproveChatJoinRequestParams {
    chat_id: number;
    user_id: number;
}

export interface DeclineChatJoinRequestParams {
    chat_id: number;
    user_id: number;
}

export interface SetChatPhotoParams {
    chat_id: number;
    photo: InputFile;
}

export interface DeleteChatPhotoParams {
    chat_id: number;
}

export interface SetChatTitleParams {
    chat_id: number;
    title: string;
}

export interface SetChatDescriptionParams {
    chat_id: number;
    description?: string;
}

export interface PinChatMessageParams {
    chat_id: number;
    message_id: number;
    disable_notification?: boolean;
    business_connection_id?: string;
}

export interface UnpinChatMessageParams {
    chat_id: number;
    message_id?: number;
    business_connection_id?: string;
}

export interface UnpinAllChatMessagesParams {
    chat_id: number;
}

export interface LeaveChatParams {
    chat_id: number;
}

export interface GetChatParams {
    chat_id: number;
}

export interface GetChatAdministratorsParams {
    chat_id: number;
}

export interface GetChatMemberCountParams {
    chat_id: number;
}

export interface GetChatMemberParams {
    chat_id: number;
    user_id: number;
}

export interface SetChatStickerSetParams {
    chat_id: number;
    sticker_set_name: string;
}

export interface DeleteChatStickerSetParams {
    chat_id: number;
}

export interface GetForumTopicIconStickersParams {
    [key: string]: never;
}

export interface CreateForumTopicParams {
    chat_id: number;
    name: string;
    icon_color?: number;
    icon_custom_emoji_id?: string;
}

export interface EditForumTopicParams {
    chat_id: number;
    message_thread_id: number;
    name?: string;
    icon_custom_emoji_id?: string;
}

export interface CloseForumTopicParams {
    chat_id: number;
    message_thread_id: number;
}

export interface ReopenForumTopicParams {
    chat_id: number;
    message_thread_id: number;
}

export interface DeleteForumTopicParams {
    chat_id: number;
    message_thread_id: number;
}

export interface UnpinAllForumTopicMessagesParams {
    chat_id: number;
    message_thread_id: number;
}

export interface EditGeneralForumTopicParams {
    chat_id: number;
    name: string;
}

export interface CloseGeneralForumTopicParams {
    chat_id: number;
}

export interface ReopenGeneralForumTopicParams {
    chat_id: number;
}

export interface HideGeneralForumTopicParams {
    chat_id: number;
}

export interface UnhideGeneralForumTopicParams {
    chat_id: number;
}

export interface UnpinAllGeneralForumTopicMessagesParams {
    chat_id: number;
}

export interface AnswerCallbackQueryParams {
    callback_query_id: string;
    text?: string;
    show_alert?: boolean;
    url?: string;
    cache_time?: number;
}

export interface GetUserProfilePhotosParams {
    user_id: number;
    offset?: number;
    limit?: number;
}

export interface GetFileParams {
    file_id: string;
}

export interface SetMyCommandsParams {
    commands: BotCommand[];
    scope?: BotCommandScope;
    language_code?: string;
}

export interface DeleteMyCommandsParams {
    scope?: BotCommandScope;
    language_code?: string;
}

export interface GetMyCommandsParams {
    scope?: BotCommandScope;
    language_code?: string;
}

export interface SetMyNameParams {
    name: string;
    language_code?: string;
}

export interface GetMyNameParams {
    language_code?: string;
}

export interface SetMyDescriptionParams {
    description: string;
    language_code?: string;
}

export interface GetMyDescriptionParams {
    language_code?: string;
}

export interface SetMyShortDescriptionParams {
    short_description: string;
    language_code?: string;
}

export interface GetMyShortDescriptionParams {
    language_code?: string;
}

export interface SetChatMenuButtonParams {
    chat_id?: number;
    menu_button?: MenuButton;
}

export interface GetChatMenuButtonParams {
    chat_id?: number;
}

export interface SetMyDefaultAdministratorRightsParams {
    rights?: ChatAdministratorRights;
    for_channels?: boolean;
}

export interface GetMyDefaultAdministratorRightsParams {
    for_channels?: boolean;
}

export interface AnswerInlineQueryParams {
    inline_query_id: string;
    results: InlineQueryResult[];
    cache_time?: number;
    is_personal?: boolean;
    next_offset?: string;
    button?: any;
}

export interface AnswerWebAppQueryParams {
    web_app_query_id: string;
    result: InlineQueryResult;
}

export interface SendInvoiceParams {
    chat_id: number;
    title: string;
    description: string;
    payload: string;
    provider_token?: string;
    currency: string;
    prices: LabeledPrice[];
    max_tip_amount?: number;
    suggested_tip_amounts?: number[];
    start_parameter?: string;
    provider_data?: string;
    photo_url?: string;
    photo_size?: number;
    photo_width?: number;
    photo_height?: number;
    need_name?: boolean;
    need_phone_number?: boolean;
    need_email?: boolean;
    need_shipping_address?: boolean;
    send_phone_number_to_provider?: boolean;
    send_email_to_provider?: boolean;
    is_flexible?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup;
    business_connection_id?: string;
}

export interface CreateInvoiceLinkParams {
    title: string;
    description: string;
    payload: string;
    provider_token?: string;
    currency: string;
    prices: LabeledPrice[];
    max_tip_amount?: number;
    suggested_tip_amounts?: number[];
    provider_data?: string;
    photo_url?: string;
    photo_size?: number;
    photo_width?: number;
    photo_height?: number;
    need_name?: boolean;
    need_phone_number?: boolean;
    need_email?: boolean;
    need_shipping_address?: boolean;
    send_phone_number_to_provider?: boolean;
    send_email_to_provider?: boolean;
    is_flexible?: boolean;
}

export interface AnswerShippingQueryParams {
    shipping_query_id: string;
    ok: boolean;
    shipping_options?: ShippingOption[];
    error_message?: string;
}

export interface AnswerPreCheckoutQueryParams {
    pre_checkout_query_id: string;
    ok: boolean;
    error_message?: string;
}

export interface GetStarTransactionsParams {
    offset?: number;
    limit?: number;
}

export interface SendGiftParams {
    user_id: number;
    gift_id: string;
    text?: string;
    text_parse_mode?: string;
    text_entities?: MessageEntity[];
    pay?: boolean;
}

export interface SendPaidMediaParams {
    chat_id: number;
    star_count: number;
    media: (InputMediaPhoto | InputMediaVideo | InputMediaAnimation | InputMediaAudio | InputMediaDocument)[];
    payload?: string;
    caption?: string;
    parse_mode?: string;
    caption_entities?: MessageEntity[];
    show_caption_above_media?: boolean;
    disable_notification?: boolean;
    protect_content?: boolean;
    reply_parameters?: any;
    reply_markup?: any;
    business_connection_id?: string;
}

export interface SetPassportDataErrorsParams {
    user_id: number;
    errors: any[];
}

export interface SendGameParams {
    chat_id: number;
    game_short_name: string;
    message_thread_id?: number;
    disable_notification?: boolean;
    protect_content?: boolean;
    message_effect_id?: string;
    reply_parameters?: any;
    reply_markup?: InlineKeyboardMarkup;
    business_connection_id?: string;
}

export interface SetGameScoreParams {
    user_id: number;
    score: number;
    force?: boolean;
    disable_edit_message?: boolean;
    chat_id?: number;
    message_id?: number;
    inline_message_id?: string;
}

export interface GetGameHighScoresParams {
    user_id: number;
    chat_id?: number;
    message_id?: number;
    inline_message_id?: string;
}

export interface GetBusinessConnectionParams {
    business_connection_id: string;
}

export interface GetUserChatBoostsParams {
    chat_id: number;
    user_id: number;
}

export interface SetStickerSetTitleParams {
    name: string;
    title: string;
}

export interface SetStickerSetThumbnailParams {
    name: string;
    user_id: number;
    thumbnail?: InputFile | string;
    format: string;
}

export interface SetCustomEmojiStickerSetThumbnailParams {
    name: string;
    custom_emoji_id: string;
}

export interface DeleteStickerSetParams {
    name: string;
}

export interface GetStickerSetParams {
    name: string;
}

export interface GetCustomEmojiStickersParams {
    custom_emoji_ids: string[];
}

export interface UploadStickerFileParams {
    user_id: number;
    sticker: InputFile;
    sticker_format: 'static' | 'animated' | 'video';
}

export interface CreateNewStickerSetParams {
    user_id: number;
    name: string;
    title: string;
    stickers: any[];
    sticker_format?: 'static' | 'animated' | 'video';
    sticker_type?: 'regular' | 'mask' | 'custom_emoji';
    needs_repainting?: boolean;
}

export interface AddStickerToSetParams {
    user_id: number;
    name: string;
    sticker: any;
}

export interface SetStickerPositionInSetParams {
    sticker: string;
    position: number;
}

export interface DeleteStickerFromSetParams {
    sticker: string;
}

export interface SetStickerEmojiListParams {
    sticker: string;
    emoji_list: string[];
}

export interface SetStickerKeywordsParams {
    sticker: string;
    keywords?: string[];
}

export interface SetStickerMaskPositionParams {
    sticker: string;
    mask_position?: any;
}

export interface LogOutParams {
    [key: string]: never;
}

export interface CloseParams {
    [key: string]: never;
}

export interface BottomButton {
    text: string;
    callback_data?: string;
    url?: string;
    web_app?: any;
    icon_custom_emoji_id?: string;
}
