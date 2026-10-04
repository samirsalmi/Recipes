import { Component, ElementRef, EventEmitter, Input, OnChanges, Output, SimpleChanges, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { StorageService } from '../../services';
import {
  Category,
  CuisineType,
  Difficulty,
  Ingredient,
  IngredientCategory,
  Recipe,
  RecipeCreateInput,
  RecipeStep,
  SUGGESTED_DIETARY_RESTRICTIONS
} from '../../models';

interface DraftIngredient {
  name: string;
  quantity: number | null;
  unit: string;
  category: IngredientCategory;
}

interface DraftStep {
  instruction: string;
  timer: number | null;
  temperature: string;
}

// Shared by add-recipe and edit-recipe: the ingredient/step/dietary/nutrition/image-upload
// form logic they both need, kept in one place so create and edit can't drift apart.
@Component({
  selector: 'app-recipe-form',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './recipe-form.component.html'
})
export class RecipeFormComponent implements OnChanges {
  private storageService = inject(StorageService);

  @Input() initialRecipe: Recipe | null = null;
  @Input() submitLabel = 'Publish Recipe';
  @Input() submittingLabel = 'Publishing...';
  @Input() isSubmitting = false;
  @Input() errorMessage = '';
  @Output() save = new EventEmitter<RecipeCreateInput>();

  @ViewChild('fileInput') fileInputRef!: ElementRef<HTMLInputElement>;

  readonly categories: Category[] = ['Breakfast', 'Lunch', 'Dinner', 'Dessert', 'Snacks'];
  readonly difficulties: Difficulty[] = ['Easy', 'Medium', 'Hard'];
  readonly cuisineTypes: CuisineType[] = [
    'Algerian', 'Italian', 'Mexican', 'Asian', 'American', 'Mediterranean', 'Indian', 'French', 'Middle Eastern', 'Other'
  ];
  readonly suggestedDietaryOptions: string[] = SUGGESTED_DIETARY_RESTRICTIONS;
  readonly ingredientCategories: IngredientCategory[] = [
    'Produce', 'Dairy', 'Meat', 'Seafood', 'Pantry', 'Bakery', 'Frozen', 'Beverages', 'Spices', 'Other'
  ];

  name = '';
  description = '';
  category: Category = 'Dinner';
  difficulty: Difficulty = 'Easy';
  cuisineType: CuisineType = 'Algerian';
  prepTime: number | null = null;
  cookTime: number | null = null;
  servings: number | null = 4;
  selectedDietary = new Set<string>();
  customDietaryInput = '';
  tagsInput = '';
  tipsInput = '';
  notes = '';

  calories: number | null = null;
  protein: number | null = null;
  carbs: number | null = null;
  fats: number | null = null;
  fiber: number | null = null;
  sugar: number | null = null;
  sodium: number | null = null;

  ingredients: DraftIngredient[] = [{ name: '', quantity: null, unit: '', category: 'Other' }];
  steps: DraftStep[] = [{ instruction: '', timer: null, temperature: '' }];

  imagePreviewUrl: string | null = null;
  uploadedImageUrl: string | null = null;
  isUploadingImage = signal(false);
  imageError = signal('');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['initialRecipe'] && this.initialRecipe) {
      this.prefill(this.initialRecipe);
    }
  }

  private prefill(recipe: Recipe): void {
    this.name = recipe.name;
    this.description = recipe.description;
    this.category = recipe.category;
    this.difficulty = recipe.difficulty;
    this.cuisineType = recipe.cuisineType;
    this.prepTime = recipe.prepTime;
    this.cookTime = recipe.cookTime;
    this.servings = recipe.servings;
    this.selectedDietary = new Set(recipe.dietaryRestrictions);
    this.tagsInput = recipe.tags.join(', ');
    this.tipsInput = (recipe.tips ?? []).join('\n');
    this.notes = recipe.notes ?? '';

    this.calories = recipe.nutrition.calories;
    this.protein = recipe.nutrition.protein;
    this.carbs = recipe.nutrition.carbs;
    this.fats = recipe.nutrition.fats;
    this.fiber = recipe.nutrition.fiber ?? null;
    this.sugar = recipe.nutrition.sugar ?? null;
    this.sodium = recipe.nutrition.sodium ?? null;

    this.ingredients = recipe.ingredients.map(ing => ({
      name: ing.name,
      quantity: ing.quantity,
      unit: ing.unit,
      category: ing.category
    }));
    this.steps = recipe.steps.map(step => ({
      instruction: step.instruction,
      timer: step.timer ?? null,
      temperature: step.temperature ?? ''
    }));

    this.imagePreviewUrl = recipe.image;
    this.uploadedImageUrl = recipe.image;
  }

  get totalTime(): number {
    return (this.prepTime || 0) + (this.cookTime || 0);
  }

  toggleDietary(option: string): void {
    if (this.selectedDietary.has(option)) {
      this.selectedDietary.delete(option);
    } else {
      this.selectedDietary.add(option);
    }
  }

  isDietarySelected(option: string): boolean {
    return this.selectedDietary.has(option);
  }

  // Custom values a user typed in, i.e. selected but not one of the suggested quick-picks.
  customDietaryTags(): string[] {
    return Array.from(this.selectedDietary).filter(o => !this.suggestedDietaryOptions.includes(o));
  }

  addCustomDietary(): void {
    const value = this.customDietaryInput.trim();
    if (value) {
      this.selectedDietary.add(value);
    }
    this.customDietaryInput = '';
  }

  addIngredient(): void {
    this.ingredients.push({ name: '', quantity: null, unit: '', category: 'Other' });
  }

  removeIngredient(index: number): void {
    if (this.ingredients.length > 1) {
      this.ingredients.splice(index, 1);
    }
  }

  addStep(): void {
    this.steps.push({ instruction: '', timer: null, temperature: '' });
  }

  removeStep(index: number): void {
    // Steps are optional - a recipe can have none, so it can be emptied all the way down.
    this.steps.splice(index, 1);
  }

  openCamera(): void {
    this.fileInputRef.nativeElement.click();
  }

  onImageSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.imageError.set('');
    this.imagePreviewUrl = URL.createObjectURL(file);
    this.uploadedImageUrl = null;
    this.isUploadingImage.set(true);

    this.storageService.uploadImage(file).subscribe({
      next: res => {
        this.uploadedImageUrl = res.url;
        this.isUploadingImage.set(false);
      },
      error: () => {
        this.isUploadingImage.set(false);
        this.imageError.set('Could not upload the photo. Please try again.');
      }
    });
  }

  removeImage(): void {
    this.imagePreviewUrl = null;
    this.uploadedImageUrl = null;
    this.imageError.set('');
    // Reset the input so picking the same file again still fires a change event.
    if (this.fileInputRef) {
      this.fileInputRef.nativeElement.value = '';
    }
  }

  get canSubmit(): boolean {
    return this.missingFields.length === 0 && !this.isUploadingImage() && !this.isSubmitting;
  }

  // Mirrors canSubmit's checks, but as human-readable labels for the "still needed" hint.
  get missingFields(): string[] {
    const missing: string[] = [];
    if (!this.name) missing.push('name');
    if (!this.description) missing.push('description');
    if (this.prepTime === null) missing.push('prep time');
    if (this.cookTime === null) missing.push('cook time');
    if (!this.servings) missing.push('servings');
    if (this.calories === null) missing.push('calories');
    if (this.protein === null) missing.push('protein');
    if (this.carbs === null) missing.push('carbs');
    if (this.fats === null) missing.push('fats');
    if (!this.ingredients.every(i => i.name && i.quantity !== null && i.unit)) missing.push('all ingredient fields');
    if (!this.steps.every(s => s.instruction)) missing.push('all step instructions');
    return missing;
  }

  submit(): void {
    if (!this.canSubmit) return;

    const ingredients: Ingredient[] = this.ingredients.map((ing, index) => ({
      id: `ing_${Date.now()}_${index}`,
      name: ing.name,
      quantity: ing.quantity!,
      unit: ing.unit,
      category: ing.category
    }));

    const steps: RecipeStep[] = this.steps.map((step, index) => ({
      stepNumber: index + 1,
      instruction: step.instruction,
      timer: step.timer ?? undefined,
      temperature: step.temperature || undefined
    }));

    const tags = this.tagsInput.split(',').map(t => t.trim()).filter(Boolean);
    const tips = this.tipsInput.split('\n').map(t => t.trim()).filter(Boolean);

    this.save.emit({
      name: this.name,
      description: this.description,
      image: this.uploadedImageUrl || '',
      category: this.category,
      difficulty: this.difficulty,
      prepTime: this.prepTime!,
      cookTime: this.cookTime!,
      totalTime: this.totalTime,
      servings: this.servings!,
      ingredients,
      steps,
      nutrition: {
        calories: this.calories!,
        protein: this.protein!,
        carbs: this.carbs!,
        fats: this.fats!,
        fiber: this.fiber ?? undefined,
        sugar: this.sugar ?? undefined,
        sodium: this.sodium ?? undefined
      },
      dietaryRestrictions: Array.from(this.selectedDietary),
      cuisineType: this.cuisineType,
      tags,
      tips: tips.length ? tips : undefined,
      notes: this.notes || undefined
    });
  }
}
