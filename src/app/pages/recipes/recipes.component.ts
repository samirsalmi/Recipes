import { Component, inject, OnInit, computed } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { RecipeService } from '../../services';
import { RecipeCardComponent, SearchBarComponent, FilterChipsComponent, FilterOption } from '../../components';
import { Category, Difficulty, DietaryRestriction, CuisineType, SortOption } from '../../models';

@Component({
  selector: 'app-recipes',
  standalone: true,
  imports: [CommonModule, RecipeCardComponent, SearchBarComponent, FilterChipsComponent],
  templateUrl: './recipes.component.html',
  styleUrls: ['./recipes.component.scss']
})
export class RecipesComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private recipeService = inject(RecipeService);

  filteredRecipes = this.recipeService.filteredRecipes;
  favorites = this.recipeService.favorites;
  viewMode = this.recipeService.viewMode;
  filter = this.recipeService.filter;
  sortOption = this.recipeService.sortOption;

  categories = this.recipeService.getCategories() as Category[];
  difficulties = this.recipeService.getDifficulties() as Difficulty[];
  dietaryRestrictions = this.recipeService.getDietaryRestrictions() as DietaryRestriction[];
  cuisineTypes = this.recipeService.getCuisineTypes() as CuisineType[];

  // Computed filter options
  categoryOptions = computed(() => 
    this.categories.map(c => ({ value: c, label: c } as FilterOption))
  );
  difficultyOptions = computed(() => 
    this.difficulties.map(d => ({ value: d, label: d } as FilterOption))
  );
  dietaryOptions = computed(() => 
    this.dietaryRestrictions.map(d => ({ value: d, label: d } as FilterOption))
  );
  cuisineOptions = computed(() =>
    this.cuisineTypes.map(c => ({ value: c, label: c } as FilterOption))
  );
  originOptions: FilterOption[] = [
    { value: 'official', label: 'Official' },
    { value: 'community', label: 'Community' }
  ];

  showFilters = false;
  searchQuery = '';

  ngOnInit(): void {
    // Check for query params
    this.route.queryParams.subscribe(params => {
      if (params['category']) {
        this.recipeService.updateFilter({ categories: [params['category']] });
      }
      if (params['difficulty']) {
        this.recipeService.updateFilter({ difficulties: [params['difficulty']] });
      }
      if (params['search']) {
        this.searchQuery = params['search'];
        this.recipeService.updateFilter({ searchQuery: params['search'] });
      }
    });
  }

  onSearchChanged(query: string): void {
    this.searchQuery = query;
    this.recipeService.updateFilter({ searchQuery: query });
  }

  onSearchCleared(): void {
    this.searchQuery = '';
    this.recipeService.updateFilter({ searchQuery: '' });
  }

  onCategorySelectionChanged(categories: string[]): void {
    this.recipeService.updateFilter({ categories: categories as Category[] });
  }

  onDifficultySelectionChanged(difficulties: string[]): void {
    this.recipeService.updateFilter({ difficulties: difficulties as Difficulty[] });
  }

  onDietarySelectionChanged(restrictions: string[]): void {
    this.recipeService.updateFilter({ dietaryRestrictions: restrictions as DietaryRestriction[] });
  }

  onCuisineSelectionChanged(cuisines: string[]): void {
    this.recipeService.updateFilter({ cuisineTypes: cuisines as CuisineType[] });
  }

  onOriginSelectionChanged(origins: string[]): void {
    this.recipeService.updateFilter({ originFilter: origins as ('official' | 'community')[] });
  }

  onSortChanged(event: Event): void {
    const select = event.target as HTMLSelectElement;
    this.recipeService.setSortOption(select.value as SortOption);
  }

  onViewModeChanged(mode: 'grid' | 'list'): void {
    this.recipeService.setViewMode(mode);
  }

  onFavoriteToggled(recipeId: string): void {
    this.recipeService.toggleFavorite(recipeId);
  }

  onAddToMealPlan(recipeId: string): void {
    this.router.navigate(['/meal-plan'], { queryParams: { addRecipe: recipeId } });
  }

  resetFilters(): void {
    this.searchQuery = '';
    this.recipeService.resetFilter();
  }

  toggleFilters(): void {
    this.showFilters = !this.showFilters;
  }

  hasActiveFilters(): boolean {
    const f = this.filter();
    return (
      f.searchQuery !== '' ||
      f.categories.length > 0 ||
      f.difficulties.length > 0 ||
      f.dietaryRestrictions.length > 0 ||
      (f.cuisineTypes && f.cuisineTypes.length > 0) ||
      (f.originFilter && f.originFilter.length > 0) ||
      f.maxCookTime !== undefined ||
      f.minRating !== undefined
    );
  }
}
