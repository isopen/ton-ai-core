export interface TgsAnimation {
    tgs?: number;
    v?: string;
    nm?: string;
    ddd?: number;
    w: number;
    h: number;
    fr: number;
    ip: number;
    op: number;
    layers: TgsLayer[];
    assets?: TgsAsset[];
    markers?: TgsMarker[];
    chars?: any[];
}

export interface TgsAsset {
    id: string;
    w?: number;
    h?: number;
    u?: string;
    p?: string;
    e?: number;
    layers?: TgsLayer[];
}

export interface TgsLayer {
    ind: number;
    ty: number;
    nm?: string;
    parent?: number;
    refId?: string;
    ks?: TgsTransform;
    shapes?: TgsShape[];
    ip?: number;
    op?: number;
    st?: number;
    sr?: number;
    ao?: number;
    tm?: TgsValue;
    hd?: boolean;
    ddd?: number;
    bm?: number;
    sc?: string;
    sw?: number;
    sh?: number;
    w?: number;
    h?: number;
    tt?: number;
    td?: number;
    masksProperties?: TgsMask[];
    t?: TgsText;
    cl?: string;
}

export interface TgsMask {
    nm?: string;
    inv?: boolean;
    mode?: string;
    pt?: TgsValue;
    o?: TgsValue;
    x?: TgsValue;
}

export interface TgsText {
    d: {
        k: TgsTextKeyframe[];
    };
    p?: any;
    m?: any;
}

export interface TgsTextKeyframe {
    t: number;
    s: {
        t: string;
        f?: string;
        s?: number;
        fc?: number[];
        j?: number;
        lh?: number;
        ls?: number;
        sc?: number[];
        sw?: number;
    };
}

export interface TgsTransform {
    o: TgsValue;
    r: TgsValue;
    p: TgsValue;
    a: TgsValue;
    s: TgsValue;
    sk?: TgsValue;
    sa?: TgsValue;
    so?: TgsValue;
    eo?: TgsValue;
}

export interface TgsShape {
    ty: string;
    nm?: string;
    mn?: string;
    hd?: boolean;
    it?: TgsShape[];
    p?: TgsValue;
    s?: TgsValue;
    r?: TgsValue;
    a?: TgsValue;
    c?: TgsValue;
    w?: TgsValue;
    o?: TgsValue;
    lc?: number;
    lj?: number;
    ml?: number;
    m?: TgsValue;
    e?: TgsValue;
    pt?: TgsValue;
    ks?: TgsValue;
    or?: TgsValue;
    ir?: TgsValue;
    ix?: number;
    os?: TgsValue | number;
    is?: TgsValue | number;
    rd?: TgsValue;
    g?: TgsGradient;
    t?: number;
    h?: TgsValue;
    l?: TgsValue;
    d?: TgsDash[];
    sy?: number;
    mm?: number;
    tr?: TgsTransform;
    sk?: TgsValue;
    sa?: TgsValue;
}

export interface TgsGradient {
    p: number;
    k: any;
    x?: TgsEasing;
}

export interface TgsDash {
    n: string;
    nm?: string;
    v: TgsValue;
}

export interface TgsValue {
    a: number;
    k: any;
    x?: TgsValue;
    y?: TgsValue;
    ix?: number;
}

export interface TgsEasing {
    x?: number[];
    y?: number[];
}

export interface TgsKeyframe {
    t: number;
    s: any;
    e?: any;
    i?: TgsEasing;
    o?: TgsEasing;
    n?: string;
    h?: number;
    to?: number[];
    ti?: number[];
}

export interface TgsMarker {
    cm: string;
    dr: number;
    tm: number;
}

export enum LayerType {
    Precomp = 0,
    Solid = 1,
    Image = 2,
    Null = 3,
    Shape = 4,
    Text = 5,
}

export enum MatteType {
    None = 0,
    Alpha = 1,
    AlphaInv = 2,
    Luma = 3,
    LumaInv = 4,
}

export enum MaskMode {
    None = 0,
    Add = 1,
    Subtract = 2,
    Intersect = 3,
    Difference = 4,
}

export enum GradientType {
    Linear = 1,
    Radial = 2,
}

export interface ParsedAnimation {
    width: number;
    height: number;
    fps: number;
    inFrame: number;
    outFrame: number;
    duration: number;
    layers: ParsedLayer[];
    assets: ParsedAsset[];
    name?: string;
    version?: string;
    tgs?: boolean;
    is3d?: boolean;
    markers?: ParsedMarker[];
}

export interface ParsedMarker {
    name: string;
    startFrame: number;
    endFrame: number;
}

export interface ParsedAsset {
    id: string;
    w?: number;
    h?: number;
    u?: string;
    p?: string;
    layers?: ParsedLayer[];
}

export interface ParsedLayer {
    index: number;
    type: LayerType;
    name?: string;
    parentIndex?: number;
    refId?: string;
    transform: ParsedTransform;
    shapes?: ParsedShape[];
    inFrame?: number;
    outFrame?: number;
    startTime?: number;
    stretch?: number;
    autoOrient?: number;
    timeRemap?: ParsedProperty;
    hidden?: boolean;
    is3d?: boolean;
    blendMode?: number;
    solidColor?: string;
    solidWidth?: number;
    solidHeight?: number;
    layerWidth?: number;
    layerHeight?: number;
    matteType?: MatteType;
    matteTarget?: boolean;
    masks?: ParsedMask[];
    text?: ParsedText;
}

export interface ParsedMask {
    name?: string;
    inverted?: boolean;
    mode: MaskMode;
    path: ParsedProperty;
    opacity: ParsedProperty;
    expand: ParsedProperty;
}

export interface ParsedText {
    text: string;
    fontSize?: number;
    fontFamily?: string;
    fillColor?: number[];
    justify?: number;
    lineHeight?: number;
    tracking?: number;
    strokeColor?: number[];
    strokeWidth?: number;
    keyframes?: TextKeyframe[];
}

export interface TextKeyframe {
    at: number;
    text: string;
    fontSize?: number;
    fontFamily?: string;
    fillColor?: number[];
    justify?: number;
    lineHeight?: number;
    tracking?: number;
    strokeColor?: number[];
    strokeWidth?: number;
}

export interface ParsedTransform {
    opacity: ParsedProperty;
    rotation: ParsedProperty;
    position: ParsedProperty;
    anchor: ParsedProperty;
    scale: ParsedProperty;
    skew?: ParsedProperty;
    skewAxis?: ParsedProperty;
    startOpacity?: ParsedProperty;
    endOpacity?: ParsedProperty;
}

export interface ParsedProperty {
    animated: boolean;
    value: any;
    keyframes?: ParsedKeyframe[];
    x?: ParsedProperty;
    y?: ParsedProperty;
}

export interface ParsedKeyframe extends TgsKeyframe {
    endFrame: number;
    hold: boolean;
    easing?: CubicBezierEasing;
}

export interface CubicBezierEasing {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
}

export interface ParsedGradient {
    type: GradientType;
    startPoint: ParsedProperty;
    endPoint: ParsedProperty;

    highlightLength?: ParsedProperty;
    highlightAngle?: ParsedProperty;
    colorPoints?: number;
    stops: ParsedProperty;
}

export interface ParsedDash {
    name: string;
    value: ParsedProperty;
}

export interface ParsedShape {
    type: string;
    name?: string;
    hidden?: boolean;
    children?: ParsedShape[];
    position?: ParsedProperty;
    anchor?: ParsedProperty;
    scale?: ParsedProperty;
    rotation?: ParsedProperty;
    opacity?: ParsedProperty;
    size?: ParsedProperty;
    radius?: ParsedProperty;
    roundness?: ParsedProperty;
    direction?: number;
    rd?: ParsedShape;
    color?: ParsedProperty;
    strokeWidth?: ParsedProperty;
    lineCap?: number;
    lineJoin?: number;
    miterLimit?: number;
    fillRule?: 'winding' | 'evenodd';
    start?: ParsedProperty;
    end?: ParsedProperty;
    offset?: ParsedProperty;

    trimMode?: 'simultaneously' | 'individually';
    vertices?: ParsedProperty;
    outerRadius?: ParsedProperty;
    innerRadius?: ParsedProperty;
    outerRoundness?: ParsedProperty;
    innerRoundness?: ParsedProperty;
    points?: ParsedProperty;
    starType?: number;
    index?: number;
    matchName?: string;
    gradient?: ParsedGradient;
    dashes?: ParsedDash[];
    copies?: ParsedProperty;
    copiesOffset?: ParsedProperty;
    composite?: number;
    mergeMode?: number;
    transform?: ParsedTransform;
}

export interface LayerInfo {
    name?: string;
    inFrame: number;
    outFrame: number;
}
