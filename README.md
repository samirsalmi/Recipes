# 🍳 Recipe Manager

A modern, feature-rich Angular application for managing recipes, meal planning, and shopping lists. Built with Angular 18+, TypeScript, Tailwind CSS, and Angular Signals for state management.

## ✨ Features

### Core Features
- **Recipe Management**: Browse, search, and filter through 40+ diverse recipes
- **Recipe Details**: View complete recipes with ingredients, instructions, and nutritional information
- **Cooking Mode**: Step-by-step cooking interface with built-in timer
- **Meal Planning**: Weekly calendar view with drag-and-drop meal planning
- **Favorites**: Save your favorite recipes with one click
- **Collections**: Organize recipes into custom collections
- **Shopping List**: Auto-generate shopping lists from meal plans or recipes

### Advanced Features
- **Advanced Search & Filtering**: Search by name, ingredients, category, difficulty, dietary restrictions, and more
- **Recipe Scaling**: Adjust serving sizes with automatic ingredient scaling
- **Dark Mode**: Toggle between light and dark themes
- **Local Storage**: All data persists locally in your browser
- **Responsive Design**: Works beautifully on mobile, tablet, and desktop
- **Smooth Animations**: Modern UI with smooth transitions and hover effects

## 🚀 Getting Started

### Prerequisites
- Node.js (v18 or higher)
- npm or yarn

### Installation

1. Navigate to the project directory:
```bash
cd recipe-manager
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm start
```

4. Open your browser and navigate to:
```
http://localhost:4200
```

## 📁 Project Structure

```
recipe-manager/
├── src/
│   ├── app/
│   │   ├── components/          # Shared components
│   │   │   ├── navbar/          # Navigation bar
│   │   │   ├── recipe-card/     # Recipe card component
│   │   │   ├── search-bar/      # Search input component
│   │   │   └── filter-chips/    # Filter chips component
│   │   ├── data/                # Mock data
│   │   │   └── mock-recipes.ts  # 40+ sample recipes
│   │   ├── models/              # TypeScript interfaces
│   │   │   ├── recipe.model.ts
│   │   │   ├── collection.model.ts
│   │   │   ├── meal-plan.model.ts
│   │   │   └── shopping-list.model.ts
│   │   ├── pages/               # Page components
│   │   │   ├── home/            # Home page
│   │   │   ├── recipes/         # Recipe listing page
│   │   │   ├── recipe-detail/   # Recipe details page
│   │   │   ├── cooking-mode/    # Step-by-step cooking
│   │   │   ├── meal-plan/       # Meal planning calendar
│   │   │   ├── favorites/       # Favorites page
│   │   │   ├── collections/     # Collections page
│   │   │   └── shopping-list/   # Shopping list page
│   │   ├── services/            # Business logic services
│   │   │   ├── storage.service.ts
│   │   │   ├── recipe.service.ts
│   │   │   ├── collection.service.ts
│   │   │   ├── meal-plan.service.ts
│   │   │   ├── shopping-list.service.ts
│   │   │   └── theme.service.ts
│   │   ├── app.ts               # Root component
│   │   ├── app.config.ts        # Angular configuration
│   │   └── app.routes.ts        # Routing configuration
│   ├── styles.scss              # Global styles
│   └── main.ts                  # Application entry point
├── tailwind.config.js           # Tailwind CSS configuration
├── postcss.config.js            # PostCSS configuration
└── package.json                 # Dependencies
```

## 🎨 Technologies Used

- **Angular 18+**: Latest Angular with standalone components
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first CSS framework
- **Angular Signals**: Reactive state management
- **RxJS**: Reactive programming for async operations
- **Local Storage**: Browser-based data persistence

## 📱 Pages

### Home Page
- Hero section with call-to-action
- Quick recipes section (under 30 minutes)
- Category browsing
- Beginner-friendly recipes
- Meal planning CTA

### Recipes Page
- Grid and list view toggle
- Advanced search and filtering
- Sort by various options
- Filter chips for categories, difficulty, dietary restrictions

### Recipe Detail Page
- Large hero image
- Ingredient list with checkboxes
- Adjustable serving sizes
- Step-by-step instructions
- Nutritional information
- Rating system
- Personal notes
- Share and print functionality

### Cooking Mode
- Large, readable text
- Step-by-step navigation
- Built-in timer
- Progress indicator
- Ingredient sidebar

### Meal Plan
- Weekly calendar view
- Add meals by date and type
- Multiple meals per day
- Generate shopping list from plan

### Favorites
- View all saved recipes
- Quick access to loved recipes

### Collections
- Create custom recipe collections
- Organize recipes by theme
- Manage collections

### Shopping List
- Auto-generate from meal plan
- Group by category
- Checkbox items
- Progress tracking
- Print functionality

## 🎯 Key Features Explained

### Recipe Scaling
When viewing a recipe, you can adjust the serving size and all ingredients will automatically scale proportionally.

### Cooking Mode
A dedicated interface for cooking with:
- Large, easy-to-read text
- One step at a time
- Built-in timer for steps that require timing
- Progress indicator

### Meal Planning
Plan your entire week with:
- Drag-and-drop interface
- Multiple meal types per day
- Visual calendar view
- Shopping list generation

### Shopping List
Generate shopping lists that:
- Combine ingredients from multiple recipes
- Group by store category
- Track what you've purchased
- Scale quantities based on servings

## 🌙 Dark Mode
Toggle between light and dark themes using the button in the navigation bar. Your preference is saved locally.

## 💾 Data Persistence
All user data is stored locally in your browser:
- Favorites
- Ratings
- Collections
- Meal plans
- Shopping lists
- Recipe notes
- Theme preference

## 📸 Images
Recipe images are sourced from Unsplash, providing high-quality food photography for each recipe.

## 🧪 Testing
Run tests with:
```bash
npm test
```

## 🏗️ Build for Production
```bash
npm run build
```

The optimized files will be in the `dist/` directory.

## 📄 License
This project is created for demonstration purposes.

## 🤝 Contributing
This is a demonstration project. Feel free to fork and modify for your own use!

---

Built with ❤️ using Angular and Tailwind CSS
