using DBZS.Codee.ModelOps.WinUI.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace DBZS.Codee.ModelOps.WinUI;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        RootView.DataContext = new MainViewModel();
    }

    private void OnNavigationSelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is not NavigationViewItem item || item.Tag is not string tag)
        {
            return;
        }

        DashboardView.Visibility = tag == "dashboard" ? Visibility.Visible : Visibility.Collapsed;
        LibraryView.Visibility = tag == "library" ? Visibility.Visible : Visibility.Collapsed;
        ScannerView.Visibility = tag == "scanner" ? Visibility.Visible : Visibility.Collapsed;
        InspectorView.Visibility = tag == "inspector" ? Visibility.Visible : Visibility.Collapsed;
        SettingsView.Visibility = tag == "settings" ? Visibility.Visible : Visibility.Collapsed;
    }
}
