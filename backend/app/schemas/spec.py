from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Dimensions(BaseModel):
    model_config = ConfigDict(extra="forbid")
    # Outer extents in millimeters (handheld packaging through large furniture / fixtures).
    length_mm: float = Field(ge=10, le=6000)
    width_mm: float = Field(ge=10, le=6000)
    # Note: for some object types (e.g. spoon), "height" is thickness and can be < 10mm.
    height_mm: float = Field(ge=1, le=6000)


class Shape(BaseModel):
    model_config = ConfigDict(extra="forbid")
    base: Literal["rounded_rectangular_box", "cylindrical_bottle", "spoon"] = "rounded_rectangular_box"
    corner_radius_mm: float = Field(ge=0, le=3000, default=2)
    lid_type: Literal["hinged", "lift_off"] = "hinged"


class Materials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    body: str = "metal"
    lid: str = "metal"
    label: str = "paper"


class RenderConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")
    camera_preset: Literal["isometric", "front"] = "isometric"
    background: Literal["studio_light", "white"] = "studio_light"


class Manufacturing(BaseModel):
    model_config = ConfigDict(extra="forbid")
    wall_thickness_mm: float = Field(default=1.5, ge=0.8, le=5.0)
    lid_clearance_mm: float = Field(default=0.2, ge=0.05, le=1.0)


class Engraving(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=40)
    depth_mm: float = Field(default=0.6, ge=0.1, le=2.0)
    font_size_mm: float = Field(default=6.0, ge=2.0, le=18.0)
    # For now we only support engraving on the spoon handle.
    location: Literal["handle_top_center"] = "handle_top_center"


class BrandContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    company: str | None = Field(default=None, max_length=120)
    brand_keywords: list[str] = Field(default_factory=list, max_length=30)
    tone: str | None = Field(default=None, max_length=120)


class ConceptContext(BaseModel):
    model_config = ConfigDict(extra="forbid")
    idea_summary: str | None = Field(default=None, max_length=800)
    stakeholder_pitch: str | None = Field(default=None, max_length=800)
    constraints: list[str] = Field(default_factory=list, max_length=40)


DomainKit = Literal[
    # Packaging / retail
    "cpg_packaging",
    "food_beverage",
    "retail_display",
    "subscription_unboxing",
    # Products / devices
    "consumer_electronics",
    "medical_device",
    "wellness_personal_care",
    "industrial_tooling",
    "home_appliance",
    "automotive_accessory",
]


class NameplateComponent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["nameplate"] = "nameplate"
    # If omitted, falls back to brand/company or product_name.
    text: str | None = Field(default=None, max_length=40)
    thickness_mm: float = Field(default=0.6, ge=0.2, le=2.0)
    font_size_mm: float = Field(default=8.0, ge=3.0, le=20.0)
    location: Literal["lid_top", "front_face"] = "lid_top"


class WrapLabelComponent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["wrap_label"] = "wrap_label"
    height_mm: float = Field(default=22.0, ge=8.0, le=200.0)
    thickness_mm: float = Field(default=0.4, ge=0.1, le=2.0)
    location: Literal["body_sides", "bottle_body"] = "body_sides"


class WindowCutoutComponent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["window_cutout"] = "window_cutout"
    size_x_mm: float = Field(default=42.0, ge=10.0, le=400.0)
    size_y_mm: float = Field(default=28.0, ge=10.0, le=400.0)
    corner_radius_mm: float = Field(default=3.0, ge=0.0, le=100.0)
    location: Literal["lid_top", "front_face"] = "lid_top"


class InsertTrayComponent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["insert_tray"] = "insert_tray"
    thickness_mm: float = Field(default=1.2, ge=0.6, le=5.0)
    clearance_mm: float = Field(default=0.8, ge=0.0, le=5.0)
    compartments: int = Field(default=1, ge=1, le=6)


class HangerHoleComponent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["hanger_hole"] = "hanger_hole"
    width_mm: float = Field(default=32.0, ge=10.0, le=120.0)
    height_mm: float = Field(default=8.0, ge=4.0, le=60.0)
    corner_radius_mm: float = Field(default=3.0, ge=0.0, le=30.0)
    location: Literal["front_face"] = "front_face"


class HolePatternComponent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["hole_pattern"] = "hole_pattern"
    diameter_mm: float = Field(default=3.0, ge=0.8, le=30.0)
    rows: int = Field(default=2, ge=1, le=12)
    cols: int = Field(default=4, ge=1, le=12)
    spacing_mm: float = Field(default=8.0, ge=2.0, le=80.0)
    location: Literal["front_face"] = "front_face"


class TamperBandComponent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["tamper_band"] = "tamper_band"
    height_mm: float = Field(default=10.0, ge=4.0, le=40.0)
    thickness_mm: float = Field(default=1.0, ge=0.4, le=4.0)
    location: Literal["bottle_neck"] = "bottle_neck"


class ButtonBossComponent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["button_boss"] = "button_boss"
    diameter_mm: float = Field(default=10.0, ge=4.0, le=60.0)
    height_mm: float = Field(default=2.0, ge=0.8, le=20.0)
    count: int = Field(default=1, ge=1, le=6)
    spacing_mm: float = Field(default=14.0, ge=4.0, le=80.0)
    location: Literal["front_face"] = "front_face"


class ScreenWindowComponent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["screen_window"] = "screen_window"
    size_x_mm: float = Field(default=52.0, ge=10.0, le=400.0)
    size_y_mm: float = Field(default=32.0, ge=10.0, le=400.0)
    corner_radius_mm: float = Field(default=4.0, ge=0.0, le=80.0)
    bezel_mm: float = Field(default=3.0, ge=0.0, le=30.0)
    location: Literal["front_face"] = "front_face"


class CarryHandleComponent(BaseModel):
    model_config = ConfigDict(extra="forbid")
    type: Literal["carry_handle"] = "carry_handle"
    width_mm: float = Field(default=90.0, ge=30.0, le=450.0)
    depth_mm: float = Field(default=18.0, ge=8.0, le=120.0)
    thickness_mm: float = Field(default=6.0, ge=2.0, le=40.0)
    location: Literal["top"] = "top"


Component = (
    NameplateComponent
    | WrapLabelComponent
    | WindowCutoutComponent
    | InsertTrayComponent
    | HangerHoleComponent
    | HolePatternComponent
    | TamperBandComponent
    | ButtonBossComponent
    | ScreenWindowComponent
    | CarryHandleComponent
)


class ProductSpec(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1.0"] = "1.0"
    mode: Literal["object"] = "object"
    object_type: Literal["tin", "box", "bottle", "tray", "spoon"] = "tin"
    requires_step: bool = True
    product_name: str = "Generated Object"
    dimensions: Dimensions
    shape: Shape
    materials: Materials = Field(default_factory=Materials)
    colors: list[str] = Field(default_factory=lambda: ["silver"])
    features: list[str] = Field(default_factory=list)
    manufacturing: Manufacturing = Field(default_factory=Manufacturing)
    engraving: Engraving | None = None
    brand: BrandContext = Field(default_factory=BrandContext)
    concept: ConceptContext = Field(default_factory=ConceptContext)
    domain_kit: DomainKit = "cpg_packaging"
    components: list[Component] = Field(default_factory=list)
    render: RenderConfig = Field(default_factory=RenderConfig)
    warnings: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_radius(self) -> ProductSpec:
        max_radius = min(self.dimensions.length_mm, self.dimensions.width_mm) / 2
        if self.shape.corner_radius_mm > max_radius:
            self.shape.corner_radius_mm = max_radius
            self.warnings.append("corner_radius_clamped_to_half_min_side")
        return self
